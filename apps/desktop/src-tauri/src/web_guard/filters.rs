//! Filter-list subscriptions for website ad blocking.
//!
//! Lists are cached on disk so the engine builds offline at startup, then a
//! background task re-downloads every enabled list once it is older than the
//! configured interval (or the shorter `! Expires:` the list declares). Conditional
//! requests (ETag / Last-Modified) keep unchanged lists from being re-transferred.

use std::path::PathBuf;
use std::time::Duration;

use adblock::lists::{FilterFormat, FilterSet, ParseOptions};
use adblock::Engine;
use serde::{Deserialize, Serialize};

pub const DEFAULT_UPDATE_HOURS: u32 = 24;
const MIN_UPDATE_HOURS: u32 = 1;
const MAX_UPDATE_HOURS: u32 = 24 * 14;
/// How long a failed download waits before it is retried.
const RETRY_AFTER_FAILURE_SECS: i64 = 60 * 60;
const MAX_LIST_BYTES: usize = 25 * 1024 * 1024;
const MAX_CUSTOM_LISTS: usize = 40;
const MAX_CUSTOM_RULES_BYTES: usize = 512 * 1024;
const MAX_ALLOWLIST: usize = 500;
const MAX_INCLUDES: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterList {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    #[serde(default)]
    pub builtin: bool,
    /// `hosts` lists (0.0.0.0 example.com) are parsed differently from ABP lists.
    #[serde(default)]
    pub hosts_format: bool,
    #[serde(default)]
    pub last_updated: Option<i64>,
    #[serde(default)]
    pub last_attempt: Option<i64>,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub rule_count: usize,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    /// Update interval the list itself declares (`! Expires: 4 days`).
    #[serde(default)]
    pub expires_hours: Option<u32>,
    /// The list pulls in other files with `!#include`.
    #[serde(default)]
    pub has_includes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterConfig {
    /// Master switch for website (non-Twitch/Kick/YouTube) ad blocking.
    pub enabled: bool,
    pub auto_update: bool,
    pub update_interval_hours: u32,
    pub lists: Vec<FilterList>,
    #[serde(default)]
    pub custom_rules: String,
    /// Hostnames where filtering is switched off (subdomains included).
    #[serde(default)]
    pub allowlist: Vec<String>,
}

fn builtin(id: &str, name: &str, url: &str, enabled: bool) -> FilterList {
    FilterList {
        id: id.into(),
        name: name.into(),
        url: url.into(),
        enabled,
        builtin: true,
        hosts_format: false,
        last_updated: None,
        last_attempt: None,
        last_error: None,
        rule_count: 0,
        etag: None,
        last_modified: None,
        expires_hours: None,
        has_includes: false,
    }
}

pub fn builtin_lists() -> Vec<FilterList> {
    vec![
        builtin(
            "easylist",
            "EasyList",
            "https://easylist.to/easylist/easylist.txt",
            true,
        ),
        builtin(
            "easyprivacy",
            "EasyPrivacy",
            "https://easylist.to/easylist/easyprivacy.txt",
            true,
        ),
        builtin(
            "ublock-filters",
            "uBlock Origin filters",
            "https://ublockorigin.github.io/uAssets/filters/filters.txt",
            true,
        ),
        builtin(
            "ublock-badware",
            "uBlock Origin badware risks",
            "https://ublockorigin.github.io/uAssets/filters/badware.txt",
            true,
        ),
        builtin(
            "peter-lowe",
            "Peter Lowe's ad and tracking server list",
            "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext",
            true,
        ),
        builtin(
            "ublock-annoyances",
            "uBlock Origin annoyances",
            "https://ublockorigin.github.io/uAssets/filters/annoyances.txt",
            false,
        ),
        builtin(
            "easylist-cookie",
            "EasyList Cookie (cookie notices)",
            "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt",
            false,
        ),
        builtin(
            "oisd-small",
            "OISD small",
            "https://small.oisd.nl/",
            false,
        ),
    ]
}

impl Default for FilterConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_update: true,
            update_interval_hours: DEFAULT_UPDATE_HOURS,
            lists: builtin_lists(),
            custom_rules: String::new(),
            allowlist: Vec::new(),
        }
    }
}

impl FilterConfig {
    /// Adds built-ins that are new in this version and clamps stored values.
    pub fn normalize(&mut self) {
        for list in builtin_lists() {
            if !self.lists.iter().any(|l| l.id == list.id) {
                self.lists.push(list);
            }
        }
        self.update_interval_hours = self
            .update_interval_hours
            .clamp(MIN_UPDATE_HOURS, MAX_UPDATE_HOURS);
        self.allowlist.truncate(MAX_ALLOWLIST);
        if self.custom_rules.len() > MAX_CUSTOM_RULES_BYTES {
            self.custom_rules = truncate_utf8(&self.custom_rules, MAX_CUSTOM_RULES_BYTES);
        }
    }

    pub fn custom_list_count(&self) -> usize {
        self.lists.iter().filter(|l| !l.builtin).count()
    }

    /// True when `host` (or one of its parents) is on the allowlist.
    pub fn is_allowlisted(&self, host: &str) -> bool {
        let host = host.trim_start_matches("www.").to_ascii_lowercase();
        self.allowlist.iter().any(|entry| {
            let entry = entry.trim_start_matches("www.");
            host == entry || host.ends_with(&format!(".{entry}"))
        })
    }
}

fn truncate_utf8(text: &str, max: usize) -> String {
    let mut end = max.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

pub fn data_dir() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("multistream");
    path.push("adblock");
    let _ = std::fs::create_dir_all(path.join("lists"));
    path
}

fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

fn list_path(id: &str) -> PathBuf {
    data_dir().join("lists").join(format!("{id}.txt"))
}

pub fn load_config() -> FilterConfig {
    let mut config = std::fs::read(config_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<FilterConfig>(&bytes).ok())
        .unwrap_or_default();
    config.normalize();
    config
}

pub fn save_config(config: &FilterConfig) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    let path = config_path();
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("failed to write ad-block config: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("failed to save ad-block config: {e}"))
}

/// List ids are generated or built in; this keeps a stored id from naming a path.
pub fn valid_list_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn validate_list_url(raw: &str) -> Result<String, String> {
    let url = raw
        .trim()
        .parse::<tauri::Url>()
        .map_err(|_| "Enter a valid filter list URL".to_string())?;
    match url.scheme() {
        "https" | "http" => Ok(url.to_string()),
        _ => Err("Filter lists must be http(s) URLs".to_string()),
    }
}

pub fn add_custom_list(config: &mut FilterConfig, name: &str, url: &str) -> Result<String, String> {
    let url = validate_list_url(url)?;
    if config.custom_list_count() >= MAX_CUSTOM_LISTS {
        return Err(format!("At most {MAX_CUSTOM_LISTS} custom lists"));
    }
    if config.lists.iter().any(|l| l.url == url) {
        return Err("That list is already subscribed".to_string());
    }
    let id = format!(
        "custom-{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let name = name.trim();
    let name = if name.is_empty() {
        url.clone()
    } else {
        name.chars().take(80).collect()
    };
    let hosts_format = url.contains("hosts");
    config.lists.push(FilterList {
        id: id.clone(),
        name,
        url,
        enabled: true,
        builtin: false,
        hosts_format,
        last_updated: None,
        last_attempt: None,
        last_error: None,
        rule_count: 0,
        etag: None,
        last_modified: None,
        expires_hours: None,
        has_includes: false,
    });
    Ok(id)
}

pub fn remove_list_file(id: &str) {
    if valid_list_id(id) {
        let _ = std::fs::remove_file(list_path(id));
    }
}

pub fn normalize_host(raw: &str) -> Option<String> {
    let trimmed = raw.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    let host = if trimmed.contains("://") {
        trimmed.parse::<tauri::Url>().ok()?.host_str()?.to_string()
    } else {
        trimmed
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("")
            .split(':')
            .next()
            .unwrap_or("")
            .to_string()
    };
    let host = host.trim_start_matches("www.").to_string();
    if host.is_empty()
        || host.len() > 253
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
    {
        return None;
    }
    Some(host)
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Effective refresh interval for a list, in seconds.
pub fn interval_secs(config: &FilterConfig, list: &FilterList) -> i64 {
    let mut hours = config.update_interval_hours.max(MIN_UPDATE_HOURS);
    if let Some(expires) = list.expires_hours.filter(|h| *h > 0) {
        hours = hours.min(expires.max(MIN_UPDATE_HOURS));
    }
    i64::from(hours) * 3600
}

/// True when the list should be (re-)downloaded now.
pub fn is_due(config: &FilterConfig, list: &FilterList, now: i64) -> bool {
    if !list.enabled {
        return false;
    }
    if !list_path(&list.id).exists() {
        return list.last_attempt.map(|t| now - t >= 60).unwrap_or(true);
    }
    if !config.auto_update {
        return false;
    }
    if list.last_error.is_some() {
        if let Some(attempt) = list.last_attempt {
            if now - attempt < RETRY_AFTER_FAILURE_SECS {
                return false;
            }
        }
    }
    match list.last_updated {
        Some(updated) => now - updated >= interval_secs(config, list),
        None => true,
    }
}

/// Parses `! Expires: 4 days` / `! Expires: 12 hours` from a list header.
pub fn parse_expires_hours(text: &str) -> Option<u32> {
    for line in text.lines().take(40) {
        let line = line.trim();
        if !line.starts_with('!') && !line.starts_with('#') {
            if !line.is_empty() && !line.starts_with('[') {
                break;
            }
            continue;
        }
        let lower = line.to_ascii_lowercase();
        let Some(rest) = lower.split("expires:").nth(1) else {
            continue;
        };
        let rest = rest.trim();
        let number: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        let value: u32 = number.parse().ok()?;
        if rest.contains("day") {
            return Some(value.saturating_mul(24));
        }
        return Some(value.max(1));
    }
    None
}

pub fn count_rules(text: &str) -> usize {
    text.lines()
        .map(str::trim)
        .filter(|l| {
            !l.is_empty()
                && !l.starts_with('!')
                && !l.starts_with('[')
                && (!l.starts_with('#')
                    || l.starts_with("##")
                    || l.starts_with("#@#")
                    || l.starts_with("#?#"))
        })
        .count()
}

pub enum FetchOutcome {
    Updated {
        text: String,
        etag: Option<String>,
        last_modified: Option<String>,
        has_includes: bool,
    },
    NotModified,
}

async fn download_text(
    client: &reqwest::Client,
    url: &str,
    conditional: Option<(&Option<String>, &Option<String>)>,
) -> Result<Option<(String, Option<String>, Option<String>)>, String> {
    let mut request = client.get(url);
    if let Some((etag, modified)) = conditional {
        if let Some(etag) = etag {
            request = request.header("If-None-Match", etag);
        }
        if let Some(modified) = modified {
            request = request.header("If-Modified-Since", modified);
        }
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED && conditional.is_some() {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("server answered {}", response.status()));
    }
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let etag = header("etag");
    let last_modified = header("last-modified");
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if bytes.len() > MAX_LIST_BYTES {
        return Err("list is larger than 25 MB".into());
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let trimmed = text.trim_start();
    if trimmed.starts_with("<!DOCTYPE") || trimmed.starts_with("<html") {
        return Err("server returned a web page, not a filter list".into());
    }
    Ok(Some((text, etag, last_modified)))
}

/// Same-origin `!#include` targets of a list (uBlock Origin splits its lists this way).
fn include_targets(text: &str, base: &tauri::Url) -> Vec<tauri::Url> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("!#include "))
        .filter_map(|path| base.join(path.trim()).ok())
        .filter(|url| url.origin() == base.origin())
        .take(MAX_INCLUDES)
        .collect()
}

pub async fn fetch_list(list: &FilterList) -> Result<FetchOutcome, String> {
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(Duration::from_secs(60))
        .user_agent(crate::USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    // A list built from includes can change while its main file does not, so only
    // lists without includes use conditional requests.
    let conditional = (list_path(&list.id).exists() && !list.has_includes)
        .then_some((&list.etag, &list.last_modified));
    let Some((text, etag, last_modified)) = download_text(&client, &list.url, conditional).await?
    else {
        return Ok(FetchOutcome::NotModified);
    };
    let base = list
        .url
        .parse::<tauri::Url>()
        .map_err(|_| "invalid list url".to_string())?;
    let includes = include_targets(&preprocess(&text), &base);
    let mut combined = text;
    let mut total = combined.len();
    for url in &includes {
        let Some((part, _, _)) = download_text(&client, url.as_str(), None).await? else {
            continue;
        };
        total += part.len();
        if total > MAX_LIST_BYTES * 2 {
            return Err("list and its includes are larger than 50 MB".into());
        }
        combined.push('\n');
        combined.push_str(&part);
    }
    Ok(FetchOutcome::Updated {
        text: preprocess(&combined),
        etag,
        last_modified,
        has_includes: !includes.is_empty(),
    })
}

/// Evaluates uBlock Origin / AdGuard `!#if` blocks for this engine (a Chromium
/// WebView without uBO's HTML filtering) and drops the inactive branches.
pub fn preprocess(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    // Each entry: (this branch is active, the enclosing block is active).
    let mut stack: Vec<(bool, bool)> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        let active = stack.last().map(|(a, _)| *a).unwrap_or(true);
        if let Some(expr) = trimmed.strip_prefix("!#if ") {
            stack.push((active && eval_condition(expr), active));
            continue;
        }
        if trimmed == "!#else" {
            if let Some((current, parent)) = stack.pop() {
                stack.push((parent && !current, parent));
            }
            continue;
        }
        if trimmed == "!#endif" {
            stack.pop();
            continue;
        }
        if active {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn token_value(token: &str) -> bool {
    matches!(
        token,
        "env_chromium" | "env_edge" | "ext_ublock" | "cap_user_stylesheet" | "true"
    )
}

/// `!`, `&&`, `||` and parentheses over the tokens above; unknown tokens are false.
fn eval_condition(expr: &str) -> bool {
    fn parse_or(tokens: &[String], pos: &mut usize) -> bool {
        let mut value = parse_and(tokens, pos);
        while tokens.get(*pos).map(String::as_str) == Some("||") {
            *pos += 1;
            let rhs = parse_and(tokens, pos);
            value = value || rhs;
        }
        value
    }
    fn parse_and(tokens: &[String], pos: &mut usize) -> bool {
        let mut value = parse_not(tokens, pos);
        while tokens.get(*pos).map(String::as_str) == Some("&&") {
            *pos += 1;
            let rhs = parse_not(tokens, pos);
            value = value && rhs;
        }
        value
    }
    fn parse_not(tokens: &[String], pos: &mut usize) -> bool {
        match tokens.get(*pos).map(String::as_str) {
            Some("!") => {
                *pos += 1;
                !parse_not(tokens, pos)
            }
            Some("(") => {
                *pos += 1;
                let value = parse_or(tokens, pos);
                if tokens.get(*pos).map(String::as_str) == Some(")") {
                    *pos += 1;
                }
                value
            }
            Some(token) => {
                *pos += 1;
                token_value(token)
            }
            None => false,
        }
    }
    let chars: Vec<char> = expr.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if (c == '&' || c == '|') && chars.get(i + 1) == Some(&c) {
            tokens.push(format!("{c}{c}"));
            i += 2;
        } else if c == '!' || c == '(' || c == ')' {
            tokens.push(c.to_string());
            i += 1;
        } else {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            if i == start {
                i += 1;
                continue;
            }
            tokens.push(chars[start..i].iter().collect());
        }
    }
    let mut pos = 0;
    parse_or(&tokens, &mut pos)
}

/// Applies a download result to the list entry and writes the cache file.
pub fn apply_fetch(list: &mut FilterList, outcome: Result<FetchOutcome, String>) {
    let now = now();
    list.last_attempt = Some(now);
    match outcome {
        Ok(FetchOutcome::NotModified) => {
            list.last_updated = Some(now);
            list.last_error = None;
        }
        Ok(FetchOutcome::Updated {
            text,
            etag,
            last_modified,
            has_includes,
        }) => match std::fs::write(list_path(&list.id), text.as_bytes()) {
            Ok(()) => {
                list.rule_count = count_rules(&text);
                list.expires_hours = parse_expires_hours(&text);
                list.etag = etag;
                list.has_includes = has_includes;
                list.last_modified = last_modified;
                list.last_updated = Some(now);
                list.last_error = None;
            }
            Err(e) => list.last_error = Some(format!("could not cache list: {e}")),
        },
        Err(error) => list.last_error = Some(error),
    }
}

pub struct BuiltEngine {
    pub engine: Engine,
    /// `source_index` from the engine's debug info → list display name.
    pub source_names: Vec<String>,
    pub total_rules: usize,
}

/// Builds the engine from every enabled, cached list plus the user's own rules.
pub fn build_engine(config: &FilterConfig) -> BuiltEngine {
    let mut set = FilterSet::new(true);
    let mut source_names = Vec::new();
    let mut total_rules = 0;
    for list in config.lists.iter().filter(|l| l.enabled) {
        let Ok(text) = std::fs::read_to_string(list_path(&list.id)) else {
            continue;
        };
        total_rules += count_rules(&text);
        let opts = ParseOptions {
            format: if list.hosts_format {
                FilterFormat::Hosts
            } else {
                FilterFormat::Standard
            },
            ..ParseOptions::default()
        };
        set.add_filter_list(text, opts);
        source_names.push(list.name.clone());
    }
    if !config.custom_rules.trim().is_empty() {
        total_rules += count_rules(&config.custom_rules);
        set.add_filter_list(config.custom_rules.clone(), ParseOptions::default());
        source_names.push("My rules".to_string());
    }
    BuiltEngine {
        engine: Engine::new_with_filter_set(set),
        source_names,
        total_rules,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_expires_header_in_days_and_hours() {
        // Arrange
        let days = "[Adblock Plus 2.0]\n! Title: EasyList\n! Expires: 4 days (update frequency)\n||ads.example^";
        let hours = "! Expires: 12 hours\n||x^";
        let none = "||ads.example^\n! Expires: 1 days";
        // Act / Assert
        assert_eq!(parse_expires_hours(days), Some(96));
        assert_eq!(parse_expires_hours(hours), Some(12));
        assert_eq!(parse_expires_hours(none), None);
    }

    #[test]
    fn preprocessor_keeps_chromium_branches_and_drops_others() {
        // Arrange
        let text = "a\n!#if env_mobile\nmobile\n!#else\ndesktop\n!#endif\n!#if env_chromium && !env_safari\nchromium\n!#endif\n!#if (env_firefox || cap_html_filtering)\nhtml\n!#endif\nz\n";
        // Act
        let out = preprocess(text);
        // Assert
        assert_eq!(out, "a\ndesktop\nchromium\nz\n");
    }

    #[test]
    fn include_targets_stay_on_the_lists_origin() {
        // Arrange
        let base: tauri::Url = "https://ublockorigin.github.io/uAssets/filters/filters.txt"
            .parse()
            .unwrap();
        let text = "!#include filters-2026.txt\n!#include https://evil.example/x.txt\n||a^";
        // Act
        let targets = include_targets(text, &base);
        // Assert
        assert_eq!(targets.len(), 1);
        assert_eq!(
            targets[0].as_str(),
            "https://ublockorigin.github.io/uAssets/filters/filters-2026.txt"
        );
    }

    #[test]
    fn list_is_due_when_stale_and_not_when_fresh() {
        // Arrange
        let config = FilterConfig::default();
        let mut list = builtin("test-due", "t", "https://example.com/l.txt", true);
        let _ = std::fs::write(list_path("test-due"), "||ads.example^");
        let now = 1_000_000;
        list.last_updated = Some(now - 3600);
        // Act
        let fresh = is_due(&config, &list, now);
        list.last_updated = Some(now - 25 * 3600);
        let stale = is_due(&config, &list, now);
        remove_list_file("test-due");
        // Assert
        assert!(!fresh);
        assert!(stale);
    }

    #[test]
    fn allowlist_matches_subdomains_only_on_boundaries() {
        // Arrange
        let config = FilterConfig {
            allowlist: vec!["example.com".into()],
            ..FilterConfig::default()
        };
        // Act / Assert
        assert!(config.is_allowlisted("example.com"));
        assert!(config.is_allowlisted("www.example.com"));
        assert!(config.is_allowlisted("cdn.example.com"));
        assert!(!config.is_allowlisted("notexample.com"));
    }

    #[test]
    fn normalizes_hosts_from_urls_and_rejects_garbage() {
        // Arrange / Act / Assert
        assert_eq!(
            normalize_host("https://www.Example.com/path"),
            Some("example.com".into())
        );
        assert_eq!(
            normalize_host("sub.example.org:8080/x"),
            Some("sub.example.org".into())
        );
        assert_eq!(normalize_host("<script>"), None);
        assert_eq!(normalize_host(""), None);
    }

    #[test]
    fn engine_blocks_listed_hosts_and_honours_exceptions() {
        // Arrange
        let mut config = FilterConfig::default();
        for list in &mut config.lists {
            list.enabled = false;
        }
        config.custom_rules = "||ads.example.com^\n@@||ads.example.com/allowed.js".into();
        // Act
        let built = build_engine(&config);
        let blocked = adblock::request::Request::new(
            "https://ads.example.com/banner.js",
            "https://news.example.org/",
            "script",
            "get",
        )
        .unwrap();
        let allowed = adblock::request::Request::new(
            "https://ads.example.com/allowed.js",
            "https://news.example.org/",
            "script",
            "get",
        )
        .unwrap();
        // Assert
        assert!(built.engine.check_network_request(&blocked).should_block());
        assert!(!built.engine.check_network_request(&allowed).should_block());
        assert_eq!(built.source_names, vec!["My rules".to_string()]);
    }

    /// Downloads the real default lists. Run with `cargo test -- --ignored live_lists`.
    #[tokio::test]
    #[ignore = "needs network access"]
    async fn live_lists_download_expand_and_block_real_ad_hosts() {
        // Arrange
        let defaults: Vec<FilterList> = builtin_lists().into_iter().filter(|l| l.enabled).collect();
        let mut texts = Vec::new();
        // Act
        for list in &defaults {
            let mut probe = list.clone();
            probe.id = format!("live-test-{}", list.id);
            match fetch_list(&probe).await.expect("list downloads") {
                FetchOutcome::Updated {
                    text, has_includes, ..
                } => {
                    if list.id == "ublock-filters" {
                        assert!(has_includes, "uBO filters should expand its includes");
                    }
                    texts.push(text);
                }
                FetchOutcome::NotModified => unreachable!("no cache for probe ids"),
            }
        }
        let mut set = FilterSet::new(true);
        for text in &texts {
            set.add_filter_list(text.clone(), ParseOptions::default());
        }
        let started = std::time::Instant::now();
        let engine = Engine::new_with_filter_set(set);
        let build_ms = started.elapsed().as_millis();
        let check = |url: &str, kind: &str| {
            let request =
                adblock::request::Request::new(url, "https://news.example.org/", kind, "get")
                    .unwrap();
            engine.check_network_request(&request).should_block()
        };
        // Assert
        let rules: usize = texts.iter().map(|t| count_rules(t)).sum();
        println!("{rules} rules, engine built in {build_ms} ms");
        assert!(rules > 50_000);
        assert!(check(
            "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
            "script"
        ));
        assert!(check(
            "https://www.googletagmanager.com/gtag/js?id=G-1",
            "script"
        ));
        assert!(!check("https://news.example.org/app.js", "script"));
    }
}
