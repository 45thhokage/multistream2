//! `msmedia` URI scheme: a CORS-adding pass-through for native HLS/DASH tiles.
//!
//! Many stream servers do not send CORS headers, so hls.js / dash.js in the app
//! page could not read their playlists. The app page asks for
//! `msmedia://localhost/o/<origin-token>/<path>?<query>` (on Windows
//! `http://msmedia.localhost/...`); this handler fetches the real URL and adds
//! `Access-Control-Allow-Origin`. HLS playlists are rewritten so segments and
//! keys come through the same path; DASH keeps relative URLs working because the
//! path layout mirrors the original origin.
//!
//! Only the app's own pages may use it: requests from website tiles, and
//! requests to loopback or private-network hosts, are refused.

use std::net::IpAddr;
use std::sync::OnceLock;
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::UriSchemeResponder;

pub const SCHEME: &str = "msmedia";
const MAX_BODY: usize = 64 * 1024 * 1024;
const TOKEN_SEPARATOR: char = '~';

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .use_rustls_tls()
            .user_agent(crate::USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .build()
            .expect("media proxy http client")
    })
}

pub fn handle(request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    tauri::async_runtime::spawn(async move {
        responder.respond(proxy(request).await);
    });
}

fn cors(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Length, Content-Range, Content-Type, Accept-Ranges",
        )
}

fn error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    cors(Response::builder().status(status))
        .header(header::CONTENT_TYPE, "text/plain")
        .body(message.as_bytes().to_vec())
        .unwrap_or_default()
}

fn is_app_origin(value: &str) -> bool {
    let Ok(url) = value.parse::<tauri::Url>() else {
        return false;
    };
    matches!(
        (url.scheme(), url.host_str()),
        ("http", Some("localhost" | "127.0.0.1"))
            | ("http" | "https", Some("tauri.localhost"))
            | ("tauri", Some("localhost"))
    )
}

/// Only pages served by the app itself may use the proxy.
fn caller_allowed(request: &Request<Vec<u8>>) -> bool {
    let header_value = |name: header::HeaderName| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    // Any page that could read a response sends Origin (CORS), so a foreign
    // Origin or Referer is refused. A request with neither is a no-cors load
    // (e.g. <video src>) whose response a foreign page cannot read anyway.
    if let Some(origin) = header_value(header::ORIGIN) {
        return origin != "null" && is_app_origin(&origin);
    }
    header_value(header::REFERER)
        .map(|r| is_app_origin(&r))
        .unwrap_or(true)
}

fn is_public_host(url: &tauri::Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(domain)) => {
            let d = domain.to_ascii_lowercase();
            !(d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local"))
        }
        Some(url::Host::Ipv4(ip)) => {
            let ip = IpAddr::V4(ip);
            !(ip.is_loopback() || ip.is_unspecified() || is_private(&ip))
        }
        Some(url::Host::Ipv6(ip)) => {
            let ip = IpAddr::V6(ip);
            !(ip.is_loopback() || ip.is_unspecified() || is_private(&ip))
        }
        None => false,
    }
}

fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_link_local()
                || v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64
        }
        IpAddr::V6(v6) => {
            let seg = v6.segments()[0];
            (seg & 0xfe00) == 0xfc00 || (seg & 0xffc0) == 0xfe80
        }
    }
}

/// `https://cdn.example:8443` + optional referer → path token.
pub fn encode_token(origin: &str, referer: Option<&str>) -> String {
    let mut token = URL_SAFE_NO_PAD.encode(origin.as_bytes());
    if let Some(referer) = referer.filter(|r| !r.is_empty()) {
        token.push(TOKEN_SEPARATOR);
        token.push_str(&URL_SAFE_NO_PAD.encode(referer.as_bytes()));
    }
    token
}

fn decode_token(token: &str) -> Option<(String, Option<String>)> {
    let mut parts = token.splitn(2, TOKEN_SEPARATOR);
    let origin = String::from_utf8(URL_SAFE_NO_PAD.decode(parts.next()?).ok()?).ok()?;
    let referer = parts
        .next()
        .and_then(|r| URL_SAFE_NO_PAD.decode(r).ok())
        .and_then(|b| String::from_utf8(b).ok());
    Some((origin, referer))
}

fn origin_of(url: &tauri::Url) -> String {
    url.origin().ascii_serialization()
}

/// Absolute URL → proxy path (absolute-path reference, resolves on the proxy host).
pub fn proxied_path(target: &tauri::Url, referer: Option<&str>) -> String {
    let mut out = format!(
        "/o/{}{}",
        encode_token(&origin_of(target), referer),
        target.path()
    );
    if let Some(query) = target.query() {
        out.push('?');
        out.push_str(query);
    }
    out
}

/// Parses `/o/<token>/<path>` + query back to the upstream URL and referer.
pub fn upstream_of(path: &str, query: Option<&str>) -> Option<(tauri::Url, Option<String>)> {
    let rest = path.strip_prefix("/o/")?;
    let (token, tail) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (origin, referer) = decode_token(token)?;
    let mut raw = format!("{origin}{tail}");
    if let Some(query) = query.filter(|q| !q.is_empty()) {
        raw.push('?');
        raw.push_str(query);
    }
    let url = raw.parse::<tauri::Url>().ok()?;
    match url.scheme() {
        "http" | "https" => Some((url, referer)),
        _ => None,
    }
}

fn proxify_reference(reference: &str, base: &tauri::Url, referer: Option<&str>) -> String {
    match base.join(reference.trim()) {
        Ok(abs) if matches!(abs.scheme(), "http" | "https") => proxied_path(&abs, referer),
        _ => reference.to_string(),
    }
}

/// Points every URI in an HLS playlist (segments, variants, keys, maps) at the proxy.
pub fn rewrite_m3u8(text: &str, base: &tauri::Url, referer: Option<&str>) -> String {
    let uri_attr = regex_uri_attr();
    let mut out = String::with_capacity(text.len() + text.len() / 2);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }
        if trimmed.starts_with('#') {
            let rewritten = uri_attr.replace_all(line, |caps: &regex::Captures| {
                format!("URI=\"{}\"", proxify_reference(&caps[1], base, referer))
            });
            out.push_str(&rewritten);
        } else {
            out.push_str(&proxify_reference(trimmed, base, referer));
        }
        out.push('\n');
    }
    out
}

fn regex_uri_attr() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r#"URI="([^"]+)""#).expect("uri attribute regex"))
}

fn regex_mpd_absolute() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(
            r#"(<BaseURL[^>]*>\s*|(?:media|initialization|sourceURL)=")(https?://[^"<\s]+)"#,
        )
        .expect("mpd url regex")
    })
}

/// Rewrites absolute URLs in a DASH manifest; relative ones already resolve via the proxy path.
pub fn rewrite_mpd(text: &str, referer: Option<&str>) -> String {
    regex_mpd_absolute()
        .replace_all(text, |caps: &regex::Captures| {
            let url = caps[2].replace("&amp;", "&");
            match url.parse::<tauri::Url>() {
                Ok(abs) => format!(
                    "{}{}",
                    &caps[1],
                    proxied_path(&abs, referer).replace('&', "&amp;")
                ),
                Err(_) => caps[0].to_string(),
            }
        })
        .into_owned()
}

async fn proxy(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return cors(Response::builder().status(StatusCode::NO_CONTENT))
            .body(Vec::new())
            .unwrap_or_default();
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return error(StatusCode::METHOD_NOT_ALLOWED, "only GET is proxied");
    }
    if !caller_allowed(&request) {
        return error(
            StatusCode::FORBIDDEN,
            "media proxy is only available to the app",
        );
    }
    let uri = request.uri();
    let Some((target, referer)) = upstream_of(uri.path(), uri.query()) else {
        return error(StatusCode::BAD_REQUEST, "malformed media proxy url");
    };
    if !is_public_host(&target) {
        return error(
            StatusCode::FORBIDDEN,
            "private network hosts are not proxied",
        );
    }

    let mut upstream = client().get(target.clone()).header(header::ACCEPT, "*/*");
    if let Some(referer) = referer.as_deref() {
        upstream = upstream.header(header::REFERER, referer);
        if let Ok(r) = referer.parse::<tauri::Url>() {
            upstream = upstream.header(header::ORIGIN, origin_of(&r));
        }
    }
    if let Some(range) = request.headers().get(header::RANGE) {
        upstream = upstream.header(header::RANGE, range.clone());
    }
    let response = match upstream.send().await {
        Ok(r) => r,
        Err(e) => {
            return error(
                StatusCode::BAD_GATEWAY,
                &format!("upstream request failed: {e}"),
            )
        }
    };
    let status = response.status();
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let passthrough: Vec<(header::HeaderName, header::HeaderValue)> = [
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::CACHE_CONTROL,
    ]
    .into_iter()
    .filter_map(|name| response.headers().get(&name).map(|v| (name, v.clone())))
    .collect();
    if response.content_length().unwrap_or(0) as usize > MAX_BODY {
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "response too large for the media proxy",
        );
    }
    let body = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return error(
                StatusCode::BAD_GATEWAY,
                &format!("upstream body failed: {e}"),
            )
        }
    };
    let path = final_url.path().to_ascii_lowercase();
    let is_hls =
        content_type.contains("mpegurl") || path.ends_with(".m3u8") || body.starts_with(b"#EXTM3U");
    let is_mpd = content_type.contains("dash+xml") || path.ends_with(".mpd");
    let (body, content_type) = if status.is_success() && is_hls {
        let text = String::from_utf8_lossy(&body);
        (
            rewrite_m3u8(&text, &final_url, referer.as_deref()).into_bytes(),
            "application/vnd.apple.mpegurl".to_string(),
        )
    } else if status.is_success() && is_mpd {
        let text = String::from_utf8_lossy(&body);
        (
            rewrite_mpd(&text, referer.as_deref()).into_bytes(),
            "application/dash+xml".to_string(),
        )
    } else {
        (body.to_vec(), content_type)
    };

    let mut builder = cors(Response::builder().status(status.as_u16()));
    if !content_type.is_empty() {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    for (name, value) in passthrough {
        builder = builder.header(name, value);
    }
    let body = if request.method() == Method::HEAD {
        Vec::new()
    } else {
        body
    };
    builder.body(body).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_upstream_urls_with_referer() {
        // Arrange
        let url: tauri::Url = "https://cdn.example.com:8443/live/a/master.m3u8?token=x%2Fy&b=1"
            .parse()
            .unwrap();
        // Act
        let path = proxied_path(&url, Some("https://site.example/room"));
        let (path_part, query) = path.split_once('?').unwrap();
        let (back, referer) = upstream_of(path_part, Some(query)).unwrap();
        // Assert
        assert_eq!(back.as_str(), url.as_str());
        assert_eq!(referer.as_deref(), Some("https://site.example/room"));
    }

    #[test]
    fn rewrites_segments_variants_and_key_uris() {
        // Arrange
        let base: tauri::Url = "https://cdn.example.com/live/master.m3u8".parse().unwrap();
        let playlist = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-STREAM-INF:BANDWIDTH=1\n720p/index.m3u8\nhttps://other.example/seg1.ts\n";
        // Act
        let out = rewrite_m3u8(playlist, &base, None);
        // Assert
        let origin = encode_token("https://cdn.example.com", None);
        let other = encode_token("https://other.example", None);
        assert!(out.contains(&format!("URI=\"/o/{origin}/live/key.bin\"")));
        assert!(out.contains(&format!("/o/{origin}/live/720p/index.m3u8")));
        assert!(out.contains(&format!("/o/{other}/seg1.ts")));
        assert!(out.starts_with("#EXTM3U\n"));
    }

    #[test]
    fn rewrites_absolute_dash_base_urls_only() {
        // Arrange
        let mpd = "<MPD><BaseURL>https://cdn.example.com/v/</BaseURL><SegmentTemplate media=\"seg-$Number$.m4s\"/></MPD>";
        // Act
        let out = rewrite_mpd(mpd, None);
        // Assert
        let origin = encode_token("https://cdn.example.com", None);
        assert!(out.contains(&format!("<BaseURL>/o/{origin}/v/</BaseURL>")));
        assert!(out.contains("media=\"seg-$Number$.m4s\""));
    }

    #[test]
    fn refuses_private_hosts_and_foreign_callers() {
        // Arrange
        let private: tauri::Url = "http://192.168.1.1/admin".parse().unwrap();
        let loopback: tauri::Url = "http://127.0.0.1:8080/x".parse().unwrap();
        let public: tauri::Url = "https://cdn.example.com/x".parse().unwrap();
        // Act / Assert
        assert!(!is_public_host(&private));
        assert!(!is_public_host(&loopback));
        assert!(is_public_host(&public));
        assert!(is_app_origin("http://localhost:14831"));
        assert!(is_app_origin("http://tauri.localhost"));
        assert!(!is_app_origin("https://evil.example"));
    }
}
