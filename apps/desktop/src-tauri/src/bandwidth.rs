//! Download accounting for the stream tiles.
//!
//! Each tile webview is observed through the DevTools Protocol's `Network` domain (Windows only,
//! via WebView2). Unlike request/response hooks, it reports the bytes that actually crossed the
//! wire for every request the page makes, including those from cross-origin iframes (the embedded
//! Twitch/Kick/YouTube players) and web workers, which are attached as child sessions.
//!
//! A once-a-second ticker turns the per-tile counters into deltas and emits them as
//! `bandwidth-stats` so the toolbar can show live usage.
//!
//! Two kinds of traffic never show up in the `Network` domain and are counted separately:
//! WebRTC (a page script reads `RTCPeerConnection` statistics and reports the bytes, see
//! `core/rtc_meter.js`) and shared workers (not attached automatically, so they are discovered
//! and attached explicitly). Service and shared workers are shared by every tile on the same
//! site, so each worker's traffic is credited to one tile only.
//!
//! Chunked media is counted as it arrives (`dataReceived`), and each finished request is topped up
//! to the size the network stack reports (`loadingFinished`, which includes headers).

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const TICK: Duration = Duration::from_secs(1);
/// Upper bound on in-flight requests remembered per tile; a leak guard, never hit in practice.
const MAX_TRACKED_REQUESTS: usize = 4096;

#[derive(Default)]
struct Counters {
    /// Bytes received per tile label since the tile opened.
    totals: HashMap<String, u64>,
    /// `totals` as of the previous tick.
    last: HashMap<String, u64>,
    /// Tiles that were closed. A closing webview lives on briefly (and its events are queued), so
    /// late traffic must not bring its counter back as a phantom tile.
    closed: HashSet<String>,
    /// Page-reported (WebRTC) bytes accepted per tile in the current window.
    reported: HashMap<String, (Instant, u64)>,
}

static COUNTERS: OnceLock<Mutex<Counters>> = OnceLock::new();

fn counters() -> std::sync::MutexGuard<'static, Counters> {
    COUNTERS
        .get_or_init(|| Mutex::new(Counters::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Adds `bytes` received by the tile with this webview label.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn record(label: &str, bytes: u64) {
    if bytes == 0 {
        return;
    }
    let mut counters = counters();
    if counters.closed.contains(label) {
        return;
    }
    let total = counters.totals.entry(label.to_string()).or_insert(0);
    *total = total.saturating_add(bytes);
}

/// Starts (or restarts) metering a tile that was just opened with this label.
pub fn track(label: &str) {
    counters().closed.remove(label);
}

/// Drops a closed tile's counters. Its bytes were already reported, so nothing is lost.
pub fn forget(label: &str) {
    let mut counters = counters();
    counters.totals.remove(label);
    counters.last.remove(label);
    counters.reported.remove(label);
    counters.closed.insert(label.to_string());
    drop(counters);
    release_shared_targets(label);
}

/// More than this per tile and second is not believable and is dropped, so a page cannot
/// inflate usage, neither with one huge report nor with a flood of smaller ones.
const MAX_REPORTED_BYTES: f64 = 50.0 * 1024.0 * 1024.0;
const REPORT_WINDOW: Duration = Duration::from_secs(1);

/// Adds bytes a page reported about its own tile (WebRTC statistics).
pub fn record_reported(label: &str, bytes: f64) {
    record_reported_at(label, bytes, Instant::now());
}

fn record_reported_at(label: &str, bytes: f64, now: Instant) {
    if !(bytes.is_finite() && bytes > 0.0 && bytes <= MAX_REPORTED_BYTES) {
        return;
    }
    let bytes = bytes as u64;
    let accepted = {
        let mut counters = counters();
        if counters.closed.contains(label) {
            return;
        }
        let window = counters
            .reported
            .entry(label.to_string())
            .or_insert((now, 0));
        if now.saturating_duration_since(window.0) >= REPORT_WINDOW {
            *window = (now, 0);
        }
        let room = (MAX_REPORTED_BYTES as u64).saturating_sub(window.1);
        let accepted = bytes.min(room);
        window.1 += accepted;
        accepted
    };
    record(label, accepted);
}

/// Service workers and shared workers serve every tile on their site, and each of those tiles
/// attaches to them. The first tile to report a worker's traffic owns it; the others skip it, so
/// the same bytes are never counted once per tile.
static SHARED_TARGETS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn shared_targets() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    SHARED_TARGETS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// True when `label` is (or becomes) the tile that owns this worker's traffic.
#[cfg_attr(not(windows), allow(dead_code))]
fn owns_shared_target(target_id: &str, label: &str) -> bool {
    let mut targets = shared_targets();
    if let Some(owner) = targets.get(target_id) {
        return owner == label;
    }
    // A closed tile must not take ownership: nothing would ever release it again, and no other
    // tile could be credited with the worker's traffic. (Checked while holding the registry, so
    // a concurrent `forget` either sees this entry and removes it or happens first.)
    if counters().closed.contains(label) {
        return false;
    }
    targets.insert(target_id.to_string(), label.to_string());
    true
}

fn release_shared_targets(label: &str) {
    shared_targets().retain(|_, owner| owner != label);
}

/// The tile stopped being attached to this worker (it navigated away, or the worker ended), so
/// another tile still using the worker may take over.
#[cfg_attr(not(windows), allow(dead_code))]
fn release_shared_target(target_id: &str, label: &str) {
    let mut targets = shared_targets();
    if targets.get(target_id).is_some_and(|owner| owner == label) {
        targets.remove(target_id);
    }
}

/// A page's report of WebRTC bytes received since its previous report.
#[tauri::command]
pub fn bandwidth_record_rtc(webview: tauri::Webview, bytes: f64) {
    let label = webview.label();
    if label.starts_with(crate::browser_tiles::TILE_WEBVIEW_PREFIX) {
        record_reported(label, bytes);
    }
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TileUsage {
    pub tile_id: String,
    /// Bytes received since the tile opened.
    pub bytes: u64,
    /// Bytes received during the last tick.
    pub delta: u64,
}

/// Compares `totals` with the previous tick and returns every known tile with its change.
fn snapshot(counters: &mut Counters) -> Vec<TileUsage> {
    let mut usage = counters
        .totals
        .iter()
        .map(|(label, &bytes)| TileUsage {
            tile_id: crate::web_guard::tile_id_of(label).to_string(),
            bytes,
            delta: bytes.saturating_sub(counters.last.get(label).copied().unwrap_or(0)),
        })
        .collect::<Vec<_>>();
    usage.sort_by(|a, b| a.tile_id.cmp(&b.tile_id));
    counters.last = counters.totals.clone();
    usage
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Stats<'a> {
    interval_ms: u64,
    tiles: &'a [TileUsage],
}

/// Starts the once-a-second ticker. Call once at startup.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(TICK);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let tiles = snapshot(&mut counters());
            let _ = app.emit(
                "bandwidth-stats",
                Stats {
                    interval_ms: TICK.as_millis() as u64,
                    tiles: &tiles,
                },
            );
        }
    });
}

/// How many bytes each DevTools `Network` event adds, without double counting a request.
#[derive(Default)]
struct Ledger {
    /// Bytes already counted for each in-flight request, keyed by (session, request id).
    counted: HashMap<(String, String), u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataReceived {
    request_id: String,
    #[serde(default)]
    encoded_data_length: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadingFinished {
    request_id: String,
    #[serde(default)]
    encoded_data_length: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestEnded {
    request_id: String,
}

#[derive(Deserialize)]
struct WebSocketFrame {
    response: WebSocketPayload,
}

#[derive(Deserialize)]
struct WebSocketPayload {
    #[serde(default)]
    opcode: u8,
    #[serde(rename = "payloadData", default)]
    payload_data: String,
}

fn to_bytes(value: f64) -> u64 {
    if value.is_finite() && value > 0.0 {
        value as u64
    } else {
        0
    }
}

impl Ledger {
    fn key(session: &str, request_id: &str) -> (String, String) {
        (session.to_string(), request_id.to_string())
    }

    /// A chunk of a response body arrived. Only the on-the-wire size counts: the protocol reports
    /// it in batches (often 0 for a chunk, then a larger figure covering several), whereas the
    /// decoded size would double count the same bytes and ignore compression.
    fn data(&mut self, session: &str, event: &DataReceived) -> u64 {
        let added = to_bytes(event.encoded_data_length);
        if added == 0 {
            return 0;
        }
        if self.counted.len() >= MAX_TRACKED_REQUESTS {
            self.counted.clear();
        }
        *self
            .counted
            .entry(Self::key(session, &event.request_id))
            .or_insert(0) += added;
        added
    }

    /// A request finished; returns what the chunks did not already account for (headers, requests
    /// that never reported chunks, and so on). Cached responses report zero and add nothing.
    fn finished(&mut self, session: &str, event: &LoadingFinished) -> u64 {
        let counted = self
            .counted
            .remove(&Self::key(session, &event.request_id))
            .unwrap_or(0);
        to_bytes(event.encoded_data_length).saturating_sub(counted)
    }

    fn ended(&mut self, session: &str, event: &RequestEnded) {
        self.counted.remove(&Self::key(session, &event.request_id));
    }

    /// A child session went away; its unfinished requests will never report again.
    #[cfg_attr(not(windows), allow(dead_code))]
    fn forget_session(&mut self, session: &str) {
        self.counted.retain(|(owner, _), _| owner != session);
    }
}

/// Bytes a WebSocket message occupies; binary frames are base64 in the protocol.
fn websocket_bytes(frame: &WebSocketFrame) -> u64 {
    let data = &frame.response.payload_data;
    let length = data.len() as u64;
    if frame.response.opcode == 2 {
        let padding = data
            .bytes()
            .rev()
            .take(2)
            .filter(|byte| *byte == b'=')
            .count() as u64;
        (length / 4 * 3).saturating_sub(padding)
    } else {
        length
    }
}

/// Turns one DevTools `Network` event into bytes for the tile, or 0 when it carries none.
fn account(ledger: &mut Ledger, event: &str, session: &str, json: &str) -> u64 {
    match event {
        "Network.dataReceived" => serde_json::from_str::<DataReceived>(json)
            .map(|data| ledger.data(session, &data))
            .unwrap_or(0),
        "Network.loadingFinished" => serde_json::from_str::<LoadingFinished>(json)
            .map(|done| ledger.finished(session, &done))
            .unwrap_or(0),
        "Network.loadingFailed" => {
            if let Ok(ended) = serde_json::from_str::<RequestEnded>(json) {
                ledger.ended(session, &ended);
            }
            0
        }
        "Network.webSocketFrameReceived" => serde_json::from_str::<WebSocketFrame>(json)
            .map(|frame| websocket_bytes(&frame))
            .unwrap_or(0),
        _ => 0,
    }
}

/// Whether a worker's URL belongs to the same site as the tile's page (`cdn.example.com` and
/// `www.example.com` do). Shared workers are only attached for the tile that created them.
#[cfg_attr(not(windows), allow(dead_code))]
fn same_site(page: &str, worker: &str) -> bool {
    /// Second-level labels under which country domains register names (`bbc.co.uk`).
    const COUNTRY_SECOND_LEVEL: [&str; 10] = [
        "co", "com", "net", "org", "gov", "edu", "ac", "ne", "or", "go",
    ];

    fn site(url: &str) -> Option<String> {
        let host = url
            .parse::<tauri::Url>()
            .ok()?
            .host_str()?
            .to_ascii_lowercase();
        // An IP address is its own site; its last two numbers say nothing.
        if host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<std::net::IpAddr>()
            .is_ok()
        {
            return Some(host);
        }
        let labels = host.split('.').collect::<Vec<_>>();
        let n = labels.len();
        let keep = if n >= 3
            && labels[n - 1].len() == 2
            && COUNTRY_SECOND_LEVEL.contains(&labels[n - 2])
        {
            3
        } else {
            2
        };
        Some(labels[n.saturating_sub(keep)..].join("."))
    }
    matches!((site(page), site(worker)), (Some(a), Some(b)) if a == b)
}

#[cfg(windows)]
pub fn attach(webview: &tauri::Webview) {
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |platform| unsafe {
        if let Err(error) = observe::install(label.clone(), platform.controller()) {
            log::warn!("bandwidth: failed to observe {label}: {error}");
        }
    });
}

#[cfg(windows)]
mod observe {
    use std::sync::{Arc, Mutex};

    use std::collections::HashMap;

    use serde::Deserialize;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{
        take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
        DevToolsProtocolEventReceivedEventHandler,
    };
    use windows_core::{Interface, HSTRING, PWSTR};

    use super::{account, owns_shared_target, record, release_shared_target, same_site, Ledger};

    /// Keep the inspector from retaining downloaded bodies; only the byte counts are wanted.
    const NETWORK_ENABLE: &str =
        r#"{"maxTotalBufferSize":1,"maxResourceBufferSize":1,"maxPostDataSize":0}"#;
    /// Also attach to frames and workers spawned by the page (and, recursively, by those).
    const AUTO_ATTACH: &str =
        r#"{"autoAttach":true,"waitForDebuggerOnStart":false,"flatten":true}"#;
    const COUNTED_EVENTS: [&str; 4] = [
        "Network.dataReceived",
        "Network.loadingFinished",
        "Network.loadingFailed",
        "Network.webSocketFrameReceived",
    ];

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TargetInfo {
        target_id: String,
        #[serde(rename = "type", default)]
        kind: String,
        #[serde(default)]
        url: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Attached {
        session_id: String,
        #[serde(default)]
        target_info: Option<TargetInfo>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Created {
        target_info: TargetInfo,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Detached {
        session_id: String,
    }

    /// Workers that serve every tile on a site; their traffic is credited to one tile only.
    fn is_shared_kind(kind: &str) -> bool {
        kind == "service_worker" || kind == "shared_worker"
    }

    /// Runs a DevTools command on the page (empty `session`) or on one of its child sessions.
    unsafe fn call(
        core: &ICoreWebView2,
        core11: &ICoreWebView2_11,
        label: &str,
        session: &str,
        method: &'static str,
        params: &str,
    ) {
        let name = HSTRING::from(method);
        let params = HSTRING::from(params);
        let log_label = label.to_string();
        let handler =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, _json| {
                if let Err(error) = result {
                    log::debug!("bandwidth: {method} on {log_label} failed: {error}");
                }
                Ok(())
            }));
        let started = if session.is_empty() {
            core.CallDevToolsProtocolMethod(&name, &params, &handler)
        } else {
            core11.CallDevToolsProtocolMethodForSession(
                &HSTRING::from(session),
                &name,
                &params,
                &handler,
            )
        };
        if let Err(error) = started {
            log::debug!("bandwidth: could not send {method} to {label}: {error}");
        }
    }

    /// Calls `on_event(session, json)` for every occurrence of a DevTools event.
    unsafe fn subscribe(
        core: &ICoreWebView2,
        event: &str,
        mut on_event: impl FnMut(&str, &str) + 'static,
    ) -> windows_core::Result<()> {
        let receiver = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event))?;
        let mut token: i64 = 0;
        receiver.add_DevToolsProtocolEventReceived(
            &DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut raw = PWSTR::null();
                args.ParameterObjectAsJson(&mut raw)?;
                if raw.is_null() {
                    return Ok(());
                }
                let json = take_pwstr(raw);
                let session = args
                    .cast::<ICoreWebView2DevToolsProtocolEventReceivedEventArgs2>()
                    .ok()
                    .and_then(|args| {
                        let mut raw = PWSTR::null();
                        args.SessionId(&mut raw).ok()?;
                        (!raw.is_null()).then(|| take_pwstr(raw))
                    })
                    .unwrap_or_default();
                on_event(&session, &json);
                Ok(())
            })),
            &mut token,
        )
    }

    pub unsafe fn install(
        label: String,
        controller: ICoreWebView2Controller,
    ) -> windows_core::Result<()> {
        let core = controller.CoreWebView2()?;
        let core11 = core.cast::<ICoreWebView2_11>()?;
        let ledger = Arc::new(Mutex::new(Ledger::default()));
        // Session id -> target id, for the service and shared workers this tile is attached to.
        let workers = Arc::new(Mutex::new(HashMap::<String, String>::new()));

        for event in COUNTED_EVENTS {
            let ledger = ledger.clone();
            let workers = workers.clone();
            let tile = label.clone();
            subscribe(&core, event, move |session, json| {
                let target = workers
                    .lock()
                    .ok()
                    .and_then(|workers| workers.get(session).cloned());
                if let Some(target) = target {
                    if !owns_shared_target(&target, &tile) {
                        return;
                    }
                }
                if let Ok(mut ledger) = ledger.lock() {
                    record(&tile, account(&mut ledger, event, session, json));
                }
            })?;
        }

        // Frames and workers show up as new sessions; each needs the same treatment.
        let (child_core, child_core11, child_label) = (core.clone(), core11.clone(), label.clone());
        let attached_workers = workers.clone();
        subscribe(&core, "Target.attachedToTarget", move |_parent, json| {
            let Ok(Attached {
                session_id,
                target_info,
            }) = serde_json::from_str::<Attached>(json)
            else {
                return;
            };
            if let Some(info) = target_info.filter(|info| is_shared_kind(&info.kind)) {
                if let Ok(mut workers) = attached_workers.lock() {
                    // The same worker can be reached twice from one tile (auto-attached through
                    // a frame and attached explicitly, or through two frames). Metering both
                    // sessions would count its traffic twice, so the extra one stays silent.
                    if workers.values().any(|target| *target == info.target_id) {
                        return;
                    }
                    workers.insert(session_id.clone(), info.target_id);
                }
            }
            unsafe {
                call(
                    &child_core,
                    &child_core11,
                    &child_label,
                    &session_id,
                    "Network.enable",
                    NETWORK_ENABLE,
                );
                call(
                    &child_core,
                    &child_core11,
                    &child_label,
                    &session_id,
                    "Target.setAutoAttach",
                    AUTO_ATTACH,
                );
            }
        })?;

        let detached_workers = workers.clone();
        let detached_ledger = ledger.clone();
        let detached_label = label.clone();
        subscribe(&core, "Target.detachedFromTarget", move |_parent, json| {
            if let Ok(Detached { session_id }) = serde_json::from_str::<Detached>(json) {
                let target = detached_workers
                    .lock()
                    .ok()
                    .and_then(|mut workers| workers.remove(&session_id));
                // This tile no longer sees the worker, so it must not keep the worker's traffic
                // to itself: another tile still using it takes over.
                if let Some(target) = target {
                    release_shared_target(&target, &detached_label);
                }
                if let Ok(mut ledger) = detached_ledger.lock() {
                    ledger.forget_session(&session_id);
                }
            }
        })?;

        // Shared workers are not attached together with the page's other children, so find them:
        // every one created on this tile's site gets the same treatment as a frame or a
        // dedicated worker.
        let (shared_core, shared_core11, shared_label) =
            (core.clone(), core11.clone(), label.clone());
        subscribe(&core, "Target.targetCreated", move |_parent, json| {
            let Ok(Created { target_info }) = serde_json::from_str::<Created>(json) else {
                return;
            };
            if target_info.kind != "shared_worker" {
                return;
            }
            let mut raw = PWSTR::null();
            let page = unsafe {
                if shared_core.Source(&mut raw).is_err() || raw.is_null() {
                    return;
                }
                take_pwstr(raw)
            };
            if !same_site(&page, &target_info.url) {
                return;
            }
            let params = serde_json::json!({ "targetId": target_info.target_id, "flatten": true })
                .to_string();
            unsafe {
                call(
                    &shared_core,
                    &shared_core11,
                    &shared_label,
                    "",
                    "Target.attachToTarget",
                    &params,
                );
            }
        })?;

        call(&core, &core11, &label, "", "Network.enable", NETWORK_ENABLE);
        call(
            &core,
            &core11,
            &label,
            "",
            "Target.setDiscoverTargets",
            r#"{"discover":true}"#,
        );
        call(
            &core,
            &core11,
            &label,
            "",
            "Target.setAutoAttach",
            AUTO_ATTACH,
        );
        log::info!("bandwidth: observing {label}");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counters_with(totals: &[(&str, u64)], last: &[(&str, u64)]) -> Counters {
        let map = |pairs: &[(&str, u64)]| {
            pairs
                .iter()
                .map(|(label, bytes)| (label.to_string(), *bytes))
                .collect()
        };
        Counters {
            totals: map(totals),
            last: map(last),
            ..Counters::default()
        }
    }

    #[test]
    fn snapshot_reports_the_bytes_since_the_previous_tick() {
        let mut state = counters_with(&[("a", 300), ("b", 50)], &[("a", 100)]);
        let usage = snapshot(&mut state);
        assert_eq!(
            usage,
            vec![
                TileUsage {
                    tile_id: "a".into(),
                    bytes: 300,
                    delta: 200
                },
                TileUsage {
                    tile_id: "b".into(),
                    bytes: 50,
                    delta: 50
                },
            ]
        );
        // A second tick with no traffic reports a zero delta, not the old one.
        let again = snapshot(&mut state);
        assert!(again.iter().all(|tile| tile.delta == 0));
    }

    #[test]
    fn snapshot_never_underflows_when_a_counter_resets() {
        let mut state = counters_with(&[("a", 10)], &[("a", 500)]);
        assert_eq!(snapshot(&mut state)[0].delta, 0);
    }

    #[test]
    fn chunks_are_counted_as_they_arrive_and_finish_adds_only_the_remainder() {
        let mut ledger = Ledger::default();
        let chunk = r#"{"requestId":"7","timestamp":1,"dataLength":1000,"encodedDataLength":1000}"#;
        assert_eq!(
            account(&mut ledger, "Network.dataReceived", "", chunk),
            1000
        );
        assert_eq!(
            account(&mut ledger, "Network.dataReceived", "", chunk),
            1000
        );
        // The network stack reports 2300 in total: 300 bytes of headers the chunks did not carry.
        let done = r#"{"requestId":"7","timestamp":2,"encodedDataLength":2300}"#;
        assert_eq!(
            account(&mut ledger, "Network.loadingFinished", "", done),
            300
        );
        // A finished request is forgotten, so a reused id starts from zero.
        assert_eq!(
            account(&mut ledger, "Network.loadingFinished", "", done),
            2300
        );
    }

    #[test]
    fn requests_without_chunk_events_are_counted_when_they_finish() {
        let mut ledger = Ledger::default();
        let done = r#"{"requestId":"1","encodedDataLength":5120.0}"#;
        assert_eq!(
            account(&mut ledger, "Network.loadingFinished", "s1", done),
            5120
        );
    }

    #[test]
    fn cached_responses_add_nothing() {
        let mut ledger = Ledger::default();
        let done = r#"{"requestId":"1","encodedDataLength":0}"#;
        assert_eq!(account(&mut ledger, "Network.loadingFinished", "", done), 0);
    }

    #[test]
    fn chunks_that_report_no_wire_size_are_left_to_the_finish_event() {
        let mut ledger = Ledger::default();
        let chunk = r#"{"requestId":"7","dataLength":4096,"encodedDataLength":0}"#;
        assert_eq!(account(&mut ledger, "Network.dataReceived", "", chunk), 0);
        let done = r#"{"requestId":"7","encodedDataLength":4200}"#;
        assert_eq!(
            account(&mut ledger, "Network.loadingFinished", "", done),
            4200
        );
    }

    #[test]
    fn the_same_request_id_in_two_sessions_is_tracked_separately() {
        let mut ledger = Ledger::default();
        let chunk = r#"{"requestId":"1","dataLength":100,"encodedDataLength":100}"#;
        account(&mut ledger, "Network.dataReceived", "frame", chunk);
        let done = r#"{"requestId":"1","encodedDataLength":100}"#;
        assert_eq!(
            account(&mut ledger, "Network.loadingFinished", "worker", done),
            100
        );
        assert_eq!(
            account(&mut ledger, "Network.loadingFinished", "frame", done),
            0
        );
    }

    #[test]
    fn failed_requests_stop_being_tracked() {
        let mut ledger = Ledger::default();
        let chunk = r#"{"requestId":"1","dataLength":100,"encodedDataLength":100}"#;
        account(&mut ledger, "Network.dataReceived", "", chunk);
        account(
            &mut ledger,
            "Network.loadingFailed",
            "",
            r#"{"requestId":"1"}"#,
        );
        assert!(ledger.counted.is_empty());
    }

    #[test]
    fn websocket_frames_count_their_payload_and_binary_is_decoded_from_base64() {
        let mut ledger = Ledger::default();
        let text = r#"{"response":{"opcode":1,"mask":false,"payloadData":"hello"}}"#;
        assert_eq!(
            account(&mut ledger, "Network.webSocketFrameReceived", "", text),
            5
        );
        let binary = r#"{"response":{"opcode":2,"mask":false,"payloadData":"AAAAAAAA"}}"#;
        assert_eq!(
            account(&mut ledger, "Network.webSocketFrameReceived", "", binary),
            6
        );
    }

    #[test]
    fn binary_websocket_frames_ignore_base64_padding() {
        let mut ledger = Ledger::default();
        // 1000 bytes encode to 1336 base64 characters ending in "==".
        let payload = format!("{}==", "A".repeat(1334));
        let binary =
            format!(r#"{{"response":{{"opcode":2,"mask":false,"payloadData":"{payload}"}}}}"#);
        assert_eq!(
            account(&mut ledger, "Network.webSocketFrameReceived", "", &binary),
            1000
        );
    }

    #[test]
    fn a_shared_worker_is_credited_to_one_tile_only() {
        assert!(owns_shared_target("sw-1", "tile-a"));
        assert!(owns_shared_target("sw-1", "tile-a"));
        assert!(!owns_shared_target("sw-1", "tile-b"));
        // When the owner closes, the next tile to report it takes over.
        release_shared_targets("tile-a");
        assert!(owns_shared_target("sw-1", "tile-b"));
        release_shared_targets("tile-b");
    }

    #[test]
    fn page_reported_bytes_are_added_and_absurd_ones_are_dropped() {
        record_reported("tile-rtc-test", 1500.0);
        record_reported("tile-rtc-test", f64::NAN);
        record_reported("tile-rtc-test", -5.0);
        record_reported("tile-rtc-test", 1e12);
        assert_eq!(counters().totals.get("tile-rtc-test").copied(), Some(1500));
        forget("tile-rtc-test");
    }

    #[test]
    fn a_flood_of_page_reports_is_capped_per_second() {
        let label = "tile-rtc-flood-test";
        let start = Instant::now();
        let max = MAX_REPORTED_BYTES as u64;
        for _ in 0..10 {
            record_reported_at(label, MAX_REPORTED_BYTES, start);
        }
        assert_eq!(counters().totals.get(label).copied(), Some(max));
        // The next second has room again.
        record_reported_at(label, 1000.0, start + REPORT_WINDOW);
        assert_eq!(counters().totals.get(label).copied(), Some(max + 1000));
        forget(label);
        track(label);
    }

    #[test]
    fn a_closed_tile_does_not_come_back_from_late_events() {
        let label = "tile-closed-test";
        record(label, 100);
        forget(label);
        // The closing webview still delivers queued network events and a last WebRTC report.
        record(label, 500);
        record_reported(label, 500.0);
        assert!(!counters().totals.contains_key(label));
        // Nor can it take a shared worker that nothing would release again.
        assert!(!owns_shared_target("sw-closed", label));
        assert!(owns_shared_target("sw-closed", "tile-closed-other"));
        release_shared_targets("tile-closed-other");
        // A tile reopened under the same label is metered again.
        track(label);
        record(label, 7);
        assert_eq!(counters().totals.get(label).copied(), Some(7));
        forget(label);
        track(label);
    }

    #[test]
    fn a_tile_that_stops_seeing_a_worker_hands_it_over() {
        assert!(owns_shared_target("sw-handover", "tile-h-a"));
        assert!(!owns_shared_target("sw-handover", "tile-h-b"));
        // Only the owner's detach releases it.
        release_shared_target("sw-handover", "tile-h-b");
        assert!(!owns_shared_target("sw-handover", "tile-h-b"));
        release_shared_target("sw-handover", "tile-h-a");
        assert!(owns_shared_target("sw-handover", "tile-h-b"));
        release_shared_targets("tile-h-b");
    }

    #[test]
    fn a_detached_session_forgets_its_unfinished_requests() {
        let mut ledger = Ledger::default();
        let chunk = r#"{"requestId":"1","dataLength":100,"encodedDataLength":100}"#;
        account(&mut ledger, "Network.dataReceived", "worker", chunk);
        account(&mut ledger, "Network.dataReceived", "page", chunk);
        ledger.forget_session("worker");
        assert_eq!(ledger.counted.len(), 1);
        assert!(ledger.counted.contains_key(&Ledger::key("page", "1")));
    }

    #[test]
    fn country_domains_and_ip_addresses_are_not_one_big_site() {
        assert!(!same_site(
            "https://www.bbc.co.uk/iplayer",
            "https://www.itv.co.uk/sw.js"
        ));
        assert!(same_site(
            "https://www.bbc.co.uk/iplayer",
            "https://static.bbc.co.uk/sw.js"
        ));
        assert!(!same_site("http://10.0.0.5/", "http://192.168.0.5/sw.js"));
        assert!(same_site("http://10.0.0.5/live", "http://10.0.0.5/sw.js"));
    }

    #[test]
    fn workers_belong_to_the_tile_page_site_only() {
        assert!(same_site(
            "https://www.camsoda.com/abbey",
            "https://cdn.camsoda.com/sw.js"
        ));
        assert!(!same_site(
            "https://www.camsoda.com/abbey",
            "https://example.org/shared.js"
        ));
        assert!(!same_site("about:blank", "https://example.org/shared.js"));
    }

    #[test]
    fn malformed_or_unrelated_events_are_ignored() {
        let mut ledger = Ledger::default();
        assert_eq!(
            account(&mut ledger, "Network.dataReceived", "", "not json"),
            0
        );
        assert_eq!(
            account(&mut ledger, "Network.requestWillBeSent", "", "{}"),
            0
        );
    }
}
