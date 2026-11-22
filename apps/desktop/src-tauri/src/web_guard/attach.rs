//! WebView2 hooks for website tiles and site windows (Windows only).
//!
//! * `WebResourceRequested` sees every request the page makes, including ones
//!   from workers, so it can both block ads and notice HLS/DASH playlists.
//! * `WebMessageReceived` is the page bridge: `core/web_guard.js` and
//!   `core/site_hls.js` post JSON strings through `chrome.webview.postMessage`.
//!   Tauri's own IPC handler also sees these messages, fails to parse them as
//!   commands and ignores them, so no app command is ever exposed to the page.

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    take_pwstr, NavigationStartingEventHandler, WebMessageReceivedEventHandler,
    WebResourceRequestedEventHandler,
};
use windows_core::{Interface, HSTRING, PWSTR};

use super::diagnostics::SiteHlsStatus;
use super::GuardState;

const MAX_MESSAGE_CHARS: usize = 256 * 1024;
const MAX_TOKENS: usize = 3000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageMessage {
    #[serde(rename = "__ms")]
    marker: Option<serde_json::Value>,
    t: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    classes: Vec<String>,
    #[serde(default)]
    ids: Vec<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    level: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    bytes: Option<f64>,
}

fn request_type(context: COREWEBVIEW2_WEB_RESOURCE_CONTEXT, is_main_frame: bool) -> &'static str {
    match context {
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT if is_main_frame => "main_frame",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => "sub_frame",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST => "xmlhttprequest",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "fetch",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => "websocket",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING => "ping",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT => "csp_report",
        _ => "other",
    }
}

fn source_of(sender: &Option<ICoreWebView2>) -> String {
    let Some(core) = sender else {
        return String::new();
    };
    let mut raw = PWSTR::null();
    unsafe {
        if core.Source(&mut raw).is_ok() {
            return take_pwstr(raw);
        }
    }
    String::new()
}

fn execute(sender: &Option<ICoreWebView2>, js: &str) {
    if let Some(core) = sender {
        unsafe {
            let _ = core.ExecuteScript(&HSTRING::from(js), None);
        }
    }
}

fn is_tile(label: &str) -> bool {
    label.starts_with(crate::browser_tiles::TILE_WEBVIEW_PREFIX)
}

fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Website tiles and site windows: ad blocking, media detection, page bridge.
    Website,
    /// App-hosted player tiles for custom embeds: media detection only.
    SniffOnly,
}

/// Installs the request filter (and, for websites, the page bridge) on one webview.
pub fn attach(app: &AppHandle, webview: &tauri::Webview, mode: Mode) {
    let label = webview.label().to_string();
    let app = app.clone();
    let _ = webview.with_webview(move |platform| unsafe {
        if let Err(error) = install(app, label.clone(), platform.controller(), mode) {
            log::warn!("web guard: failed to attach to {label}: {error}");
        }
    });
}

unsafe fn install(
    app: AppHandle,
    label: String,
    controller: ICoreWebView2Controller,
    mode: Mode,
) -> windows_core::Result<()> {
    let core = controller.CoreWebView2()?;
    let env = core.cast::<ICoreWebView2_2>()?.Environment()?;
    let filter = HSTRING::from("*");
    match core.cast::<ICoreWebView2_22>() {
        Ok(core22) => core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
            &filter,
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
        )?,
        Err(_) => {
            core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?
        }
    }

    // The main-frame URL being navigated to, so its document request is never
    // filtered and the previous page's playlists are dropped.
    let pending_nav = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let nav_pending = pending_nav.clone();
    let nav_app = app.clone();
    let nav_label = label.clone();
    let mut token: i64 = 0;
    core.add_NavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut raw = PWSTR::null();
            if args.Uri(&mut raw).is_ok() {
                let uri = take_pwstr(raw);
                if let Ok(mut pending) = nav_pending.lock() {
                    *pending = uri;
                }
                if let Ok(mut diag) = nav_app.state::<GuardState>().diag.lock() {
                    diag.clear_media(&nav_label);
                }
            }
            Ok(())
        })),
        &mut token,
    )?;

    let request_app = app.clone();
    let request_label = label.clone();
    core.add_WebResourceRequested(
        &WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let request = args.Request()?;
            let mut raw = PWSTR::null();
            request.Uri(&mut raw)?;
            let uri = take_pwstr(raw);
            if !(uri.starts_with("https://") || uri.starts_with("http://")) {
                return Ok(());
            }
            let page = source_of(&sender);
            let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            let _ = args.ResourceContext(&mut context);
            let is_main_frame = context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT
                && (uri == page
                    || pending_nav
                        .lock()
                        .map(|pending| *pending == uri)
                        .unwrap_or(false));
            if is_main_frame {
                return Ok(());
            }

            super::note_media(&request_app, &request_label, &uri, &page);
            if mode == Mode::SniffOnly {
                return Ok(());
            }

            let kind = request_type(context, is_main_frame);
            if let Some(event) =
                request_app
                    .state::<GuardState>()
                    .check_request(&request_label, &uri, &page, kind)
            {
                super::note_blocked(&request_app, event);
                let response = env.CreateWebResourceResponse(
                    None,
                    403,
                    &HSTRING::from("Blocked"),
                    &HSTRING::from("Content-Type: text/plain"),
                )?;
                args.SetResponse(&response)?;
            }
            Ok(())
        })),
        &mut token,
    )?;

    if mode == Mode::SniffOnly {
        return Ok(());
    }
    let message_app = app.clone();
    let message_label = label;
    core.add_WebMessageReceived(
        &WebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut raw = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut raw).is_err() {
                return Ok(());
            }
            let text = take_pwstr(raw);
            if text.len() > MAX_MESSAGE_CHARS || !text.contains("\"__ms\"") {
                return Ok(());
            }
            let Ok(message) = serde_json::from_str::<PageMessage>(&text) else {
                return Ok(());
            };
            if message.marker.is_none() {
                return Ok(());
            }
            handle_message(&message_app, &message_label, &sender, message);
            Ok(())
        })),
        &mut token,
    )?;
    Ok(())
}

fn handle_message(
    app: &AppHandle,
    label: &str,
    sender: &Option<ICoreWebView2>,
    mut message: PageMessage,
) {
    let state = app.state::<GuardState>();
    // The page's own claim about its URL is only used when WebView2 has none.
    let page_url = {
        let source = source_of(sender);
        if source.is_empty() {
            message.url.clone().unwrap_or_default()
        } else {
            source
        }
    };
    match message.t.as_str() {
        "page" => {
            match state.page_cosmetics(label, &page_url) {
                Some(css) => execute(
                    sender,
                    &format!(
                        "window.__msGuard&&(window.__msGuard.apply({}),window.__msGuard.setGeneric(true))",
                        js_string(&css)
                    ),
                ),
                None => execute(sender, "window.__msGuard&&window.__msGuard.setGeneric(false)"),
            }
            if state.is_hls_direct(label) {
                super::site_hls::apply(app, label, true);
            }
        }
        "classes" => {
            message.classes.truncate(MAX_TOKENS);
            message.ids.truncate(MAX_TOKENS);
            if let Some(css) = state.class_cosmetics(label, &message.classes, &message.ids) {
                execute(
                    sender,
                    &format!(
                        "window.__msGuard&&window.__msGuard.apply({})",
                        js_string(&css)
                    ),
                );
            }
        }
        "media" => {
            if let Some(url) = message.url.as_deref() {
                super::note_media(app, label, url, &page_url);
            }
        }
        "hls" => {
            let status = SiteHlsStatus {
                enabled: state.is_hls_direct(label),
                state: message.state.unwrap_or_else(|| "unknown".into()),
                source: message.source,
                url: message.url.map(|u| super::diagnostics::clip(&u)),
                level: message.level,
                message: message.message.map(|m| m.chars().take(300).collect()),
                updated_at: chrono::Utc::now().timestamp_millis(),
            };
            if let Ok(mut diag) = state.diag.lock() {
                diag.site_hls.insert(label.to_string(), status.clone());
            }
            let _ = app.emit(
                "site-hls-status",
                serde_json::json!({ "tileId": super::tile_id_of(label), "status": status }),
            );
        }
        // The two below only concern stream tiles. Site windows share this bridge, and a page
        // there must not invent a tile in the data-usage meter or a fit state for one.
        "rtc" if is_tile(label) => {
            // WebRTC bytes the page received since its last report (see core/rtc_meter.js).
            if let Some(bytes) = message.bytes {
                crate::bandwidth::record_reported(label, bytes);
            }
        }
        "fit" if is_tile(label) => {
            // "on" / "off" / "none" (no video found to fit). Anything else is not passed on.
            let state = message.state.unwrap_or_default();
            if matches!(state.as_str(), "on" | "off" | "none") {
                let _ = app.emit(
                    "tile-fit-state",
                    serde_json::json!({
                        "tileId": super::tile_id_of(label),
                        "state": state,
                    }),
                );
            }
        }
        _ => {}
    }
}
