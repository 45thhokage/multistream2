//! Website guard: general ad blocking, media detection and the page bridge for
//! website tiles and site windows.
//!
//! This is deliberately separate from the Twitch/Kick/YouTube ad handling in
//! `core/stream_filter.js`: it only attaches to website tiles and pop-out site
//! windows, and pages on those three platforms are never filtered here.

pub mod commands;
pub mod diagnostics;
pub mod filters;
pub mod site_hls;

#[cfg(windows)]
pub mod attach;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use adblock::request::Request;
use adblock::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use diagnostics::{clip, BlockedEvent, DetectedMedia, Diagnostics};
use filters::FilterConfig;

/// Page script that reports the page and its CSS classes/ids for cosmetic filtering.
pub const GUARD_SCRIPT: &str = include_str!("../core/web_guard.js");

const UPDATE_TICK: Duration = Duration::from_secs(15 * 60);

/// Pages on these hosts keep their own (platform-specific) ad handling.
const PLATFORM_HOSTS: &[&str] = &[
    "twitch.tv",
    "twitch.com",
    "ttvnw.net",
    "kick.com",
    "kick.cx",
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "googlevideo.com",
];

pub struct EngineHandle {
    pub engine: Engine,
    pub source_names: Vec<String>,
}

#[derive(Default, Clone)]
struct PageCosmetic {
    exceptions: HashSet<String>,
    generichide: bool,
    disabled: bool,
}

pub struct GuardState {
    pub config: Mutex<FilterConfig>,
    engine: RwLock<Option<Arc<EngineHandle>>>,
    pub diag: Mutex<Diagnostics>,
    cosmetic: Mutex<HashMap<String, PageCosmetic>>,
    pub hls_direct: Mutex<HashSet<String>>,
    pub updating: AtomicBool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaDetectedPayload {
    pub tile_id: String,
    pub url: String,
    pub kind: String,
}

pub fn host_of(url: &str) -> String {
    url.parse::<tauri::Url>()
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .unwrap_or_default()
}

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

pub fn is_platform_host(host: &str) -> bool {
    PLATFORM_HOSTS.iter().any(|d| host_matches(host, d))
}

/// `tile-<id>` → `<id>`; other labels (site windows) are returned unchanged.
pub fn tile_id_of(label: &str) -> &str {
    label
        .strip_prefix(crate::browser_tiles::TILE_WEBVIEW_PREFIX)
        .unwrap_or(label)
}

/// Classifies media playlist and file URLs by path extension.
pub fn media_kind(url: &str) -> Option<&'static str> {
    let parsed = url.parse::<tauri::Url>().ok()?;
    let path = parsed.path().to_ascii_lowercase();
    if path.ends_with(".m3u8") || path.ends_with(".m3u") {
        Some("hls")
    } else if path.ends_with(".mpd") {
        Some("dash")
    } else {
        None
    }
}

impl GuardState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(filters::load_config()),
            engine: RwLock::new(None),
            diag: Mutex::new(Diagnostics::default()),
            cosmetic: Mutex::new(HashMap::new()),
            hls_direct: Mutex::new(HashSet::new()),
            updating: AtomicBool::new(false),
        }
    }

    fn engine(&self) -> Option<Arc<EngineHandle>> {
        self.engine.read().ok().and_then(|g| g.clone())
    }

    pub fn has_engine(&self) -> bool {
        self.engine().is_some()
    }

    /// Whether requests on a page with this host are filtered at all.
    pub fn filters_page(&self, page_host: &str) -> bool {
        if page_host.is_empty() || is_platform_host(page_host) {
            return false;
        }
        let Ok(config) = self.config.lock() else {
            return false;
        };
        config.enabled && !config.is_allowlisted(page_host)
    }

    /// Network check for one request. Returns the event to log when it is blocked.
    pub fn check_request(
        &self,
        webview: &str,
        url: &str,
        page_url: &str,
        request_type: &str,
    ) -> Option<BlockedEvent> {
        let page_host = host_of(page_url);
        if !self.filters_page(&page_host) {
            return None;
        }
        let host = host_of(url);
        if host.is_empty() || host.ends_with(".localhost") || host == "localhost" {
            return None;
        }
        let handle = self.engine()?;
        let request = Request::new(url, page_url, request_type, "get").ok()?;
        let result = handle.engine.check_network_request(&request);
        if !result.should_block() {
            return None;
        }
        let (rule, list) = match &result.filter {
            Some(info) => (
                info.raw_line.clone(),
                info.source_location
                    .as_ref()
                    .and_then(|loc| handle.source_names.get(loc.source_index as usize).cloned()),
            ),
            None => (None, None),
        };
        Some(BlockedEvent {
            time: chrono::Utc::now().timestamp_millis(),
            webview: webview.to_string(),
            url: clip(url),
            host,
            page_host,
            request_type: request_type.to_string(),
            rule,
            list,
        })
    }

    /// Hide rules for a freshly loaded page; remembers its exceptions for class/id queries.
    pub fn page_cosmetics(&self, webview: &str, page_url: &str) -> Option<String> {
        let page_host = host_of(page_url);
        let enabled = self.filters_page(&page_host);
        let handle = self.engine();
        let mut map = self.cosmetic.lock().ok()?;
        let (Some(handle), true) = (handle, enabled) else {
            map.insert(
                webview.to_string(),
                PageCosmetic {
                    disabled: true,
                    ..PageCosmetic::default()
                },
            );
            return None;
        };
        let resources = handle.engine.url_cosmetic_resources(page_url);
        map.insert(
            webview.to_string(),
            PageCosmetic {
                exceptions: resources.exceptions,
                generichide: resources.generichide,
                disabled: false,
            },
        );
        Some(css_for(resources.hide_selectors.iter().map(String::as_str)))
    }

    /// Generic hide rules that apply to the class names and ids a page reported.
    pub fn class_cosmetics(
        &self,
        webview: &str,
        classes: &[String],
        ids: &[String],
    ) -> Option<String> {
        let page = self.cosmetic.lock().ok()?.get(webview).cloned()?;
        if page.disabled || page.generichide {
            return None;
        }
        let handle = self.engine()?;
        let selectors = handle
            .engine
            .hidden_class_id_selectors(classes, ids, &page.exceptions);
        if selectors.is_empty() {
            return None;
        }
        Some(css_for(selectors.iter().map(String::as_str)))
    }

    pub fn forget_webview(&self, webview: &str) {
        if let Ok(mut map) = self.cosmetic.lock() {
            map.remove(webview);
        }
        if let Ok(mut diag) = self.diag.lock() {
            diag.forget_webview(webview);
        }
        if let Ok(mut direct) = self.hls_direct.lock() {
            direct.remove(webview);
        }
    }

    pub fn is_hls_direct(&self, webview: &str) -> bool {
        self.hls_direct
            .lock()
            .map(|set| set.contains(webview))
            .unwrap_or(false)
    }
}

/// One rule per selector: an invalid selector then only drops itself.
fn css_for<'a>(selectors: impl Iterator<Item = &'a str>) -> String {
    let mut css = String::new();
    for selector in selectors {
        if selector.contains('{') || selector.contains('}') || selector.contains("</") {
            continue;
        }
        css.push_str(selector);
        css.push_str("{display:none!important}\n");
    }
    css
}

/// Records a media playlist seen in a webview; emits once per new URL.
pub fn note_media(app: &AppHandle, webview: &str, url: &str, page_url: &str) {
    let Some(kind) = media_kind(url) else {
        return;
    };
    let state = app.state::<GuardState>();
    let is_new = match state.diag.lock() {
        Ok(mut diag) => diag.record_media(
            webview,
            DetectedMedia {
                url: url.to_string(),
                kind: kind.to_string(),
                page_url: clip(page_url),
                detected_at: chrono::Utc::now().timestamp_millis(),
            },
        ),
        Err(_) => false,
    };
    if is_new {
        let _ = app.emit(
            "tile-media-detected",
            MediaDetectedPayload {
                tile_id: tile_id_of(webview).to_string(),
                url: url.to_string(),
                kind: kind.to_string(),
            },
        );
        if state.is_hls_direct(webview) && kind == "hls" {
            site_hls::offer(app, webview, url);
        }
    }
}

pub fn note_blocked(app: &AppHandle, event: BlockedEvent) {
    let state = app.state::<GuardState>();
    if let Ok(mut diag) = state.diag.lock() {
        diag.record_blocked(event);
    };
}

/// Rebuilds the engine off the async runtime and swaps it in.
pub async fn rebuild(app: &AppHandle) {
    let config = {
        let state = app.state::<GuardState>();
        let Ok(config) = state.config.lock() else {
            return;
        };
        config.clone()
    };
    let started = Instant::now();
    let built = tauri::async_runtime::spawn_blocking(move || filters::build_engine(&config)).await;
    let state = app.state::<GuardState>();
    match built {
        Ok(built) => {
            if let Ok(mut slot) = state.engine.write() {
                *slot = Some(Arc::new(EngineHandle {
                    engine: built.engine,
                    source_names: built.source_names,
                }));
            }
            if let Ok(mut diag) = state.diag.lock() {
                diag.engine_built_at = Some(chrono::Utc::now().timestamp_millis());
                diag.engine_build_ms = Some(started.elapsed().as_millis() as u64);
                diag.engine_rules = built.total_rules;
                diag.engine_error = None;
            }
        }
        Err(error) => {
            if let Ok(mut diag) = state.diag.lock() {
                diag.engine_error = Some(format!("engine build failed: {error}"));
            }
        }
    }
    let _ = app.emit("adblock-updated", ());
}

/// Downloads every due list (all enabled lists when `force`), then rebuilds if anything changed.
pub async fn update_lists(app: &AppHandle, force: bool) -> Result<usize, String> {
    let state = app.state::<GuardState>();
    if state.updating.swap(true, Ordering::SeqCst) {
        return Err("An update is already running".to_string());
    }
    let _ = app.emit("adblock-updating", true);
    let result = update_lists_inner(app, force).await;
    let state = app.state::<GuardState>();
    state.updating.store(false, Ordering::SeqCst);
    if let Ok(mut diag) = state.diag.lock() {
        diag.last_update_check = Some(chrono::Utc::now().timestamp_millis());
    }
    let _ = app.emit("adblock-updating", false);
    result
}

async fn update_lists_inner(app: &AppHandle, force: bool) -> Result<usize, String> {
    let due: Vec<filters::FilterList> = {
        let state = app.state::<GuardState>();
        let config = state.config.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp();
        config
            .lists
            .iter()
            .filter(|l| l.enabled && (force || filters::is_due(&config, l, now)))
            .cloned()
            .collect()
    };
    if due.is_empty() {
        return Ok(0);
    }
    let fetches = due
        .iter()
        .map(|list| async move { (list.id.clone(), filters::fetch_list(list).await) });
    let results = futures_util::future::join_all(fetches).await;
    let mut changed = 0;
    {
        let state = app.state::<GuardState>();
        let mut config = state.config.lock().map_err(|e| e.to_string())?;
        for (id, outcome) in results {
            if let Some(list) = config.lists.iter_mut().find(|l| l.id == id) {
                let modified = matches!(outcome, Ok(filters::FetchOutcome::Updated { .. }));
                filters::apply_fetch(list, outcome);
                if modified && list.last_error.is_none() {
                    changed += 1;
                }
            }
        }
        filters::save_config(&config)?;
    }
    if changed > 0 || !app.state::<GuardState>().has_engine() {
        rebuild(app).await;
    } else {
        let _ = app.emit("adblock-updated", ());
    }
    Ok(changed)
}

/// Builds from the on-disk cache right away, then keeps subscriptions current.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        rebuild(&app).await;
        // Give startup network traffic (players, live status) a head start.
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            let _ = update_lists(&app, false).await;
            tokio::time::sleep(UPDATE_TICK).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_pages_are_never_filtered() {
        // Arrange / Act / Assert
        assert!(is_platform_host("www.twitch.tv"));
        assert!(is_platform_host("kick.com"));
        assert!(is_platform_host("m.youtube.com"));
        assert!(!is_platform_host("chaturbate.com"));
        assert!(!is_platform_host("notkick.com"));
    }

    #[test]
    fn detects_media_playlists_by_extension() {
        // Arrange / Act / Assert
        assert_eq!(
            media_kind("https://cdn.example/live/master.m3u8?token=1"),
            Some("hls")
        );
        assert_eq!(media_kind("https://cdn.example/manifest.mpd"), Some("dash"));
        assert_eq!(media_kind("https://cdn.example/app.js?x=.m3u8"), None);
    }

    #[test]
    fn css_skips_selectors_that_could_escape_the_rule() {
        // Arrange
        let selectors = [".ad-banner", "#x{}", "div[data-ad]"];
        // Act
        let css = css_for(selectors.iter().copied());
        // Assert
        assert!(css.contains(".ad-banner{display:none!important}"));
        assert!(css.contains("div[data-ad]{display:none!important}"));
        assert!(!css.contains("#x{}"));
    }

    #[test]
    fn tile_ids_are_taken_from_webview_labels() {
        // Arrange / Act / Assert
        assert_eq!(tile_id_of("tile-abc"), "abc");
        assert_eq!(tile_id_of("site-xyz"), "site-xyz");
    }
}
