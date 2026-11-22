use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager};

pub(crate) const TILE_WEBVIEW_PREFIX: &str = "tile-";
const MAX_ID_LEN: usize = 40;
const MAX_BATCH: usize = 64;

/// Where a parked tile waits. It stays "visible" to WebView2, so the page keeps rendering and
/// playing, but it is far outside the window and cannot cover UI such as dialogs.
const PARK_POSITION: f64 = -10000.0;

type TileRect = (LogicalPosition<f64>, LogicalSize<f64>);

#[derive(Default)]
struct TileGeometry {
    /// Last bounds the frontend asked for, so a parked tile can return to them.
    bounds: HashMap<String, TileRect>,
    parked: HashSet<String>,
    /// Window areas (logical px) that tiles must leave uncovered, e.g. an open dialog or a
    /// revealed side panel.
    cutouts: Vec<CutoutRect>,
}

#[derive(serde::Deserialize, Clone, Copy)]
pub struct CutoutRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

static GEOMETRY: OnceLock<Mutex<TileGeometry>> = OnceLock::new();

fn geometry() -> std::sync::MutexGuard<'static, TileGeometry> {
    GEOMETRY
        .get_or_init(|| Mutex::new(TileGeometry::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn tile_label(tile_id: &str) -> Result<String, String> {
    if tile_id.is_empty()
        || tile_id.len() > MAX_ID_LEN
        || !tile_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid tile id".to_string());
    }
    Ok(format!("{TILE_WEBVIEW_PREFIX}{tile_id}"))
}

fn validate_tile_url(raw: &str) -> Result<tauri::Url, String> {
    let parsed = raw
        .parse::<tauri::Url>()
        .map_err(|_| "invalid tile url".to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("only http(s) tile urls are allowed".to_string()),
    }
}

pub(crate) fn validate_tile_bounds(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    if ![x, y, width, height].iter().all(|v| v.is_finite()) {
        return Err("tile bounds must be finite numbers".to_string());
    }
    if width <= 0.0 || height <= 0.0 {
        return Err("tile bounds must have positive size".to_string());
    }
    Ok((LogicalPosition::new(x, y), LogicalSize::new(width, height)))
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TileTitleChanged {
    pub tile_id: String,
    pub title: String,
}

pub(crate) fn tile_user_agent(mobile: bool) -> &'static str {
    if mobile {
        crate::MOBILE_USER_AGENT
    } else {
        crate::USER_AGENT
    }
}

fn tile_popup_label(label: &str) -> String {
    format!("{label}-popup")
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn open_tile_webview(
    app: AppHandle,
    tile_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    mobile: bool,
    sniff: Option<bool>,
) -> Result<String, String> {
    let label = tile_label(&tile_id)?;
    let parsed = validate_tile_url(&url)?;
    let (position, size) = validate_tile_bounds(x, y, width, height)?;

    if let Some(existing) = app.get_webview(&label) {
        let parked = {
            let mut tiles = geometry();
            tiles.bounds.insert(label.clone(), (position, size));
            tiles.parked.contains(&label)
        };
        if !parked {
            let _ = existing.set_position(position);
        }
        let _ = existing.set_size(size);
        clip_tile(&app, &label);
        if existing
            .url()
            .map(|u| u.as_str() != parsed.as_str())
            .unwrap_or(true)
        {
            existing
                .navigate(parsed)
                .map_err(|e| format!("failed to navigate tile webview: {e}"))?;
        }
        return Ok(label);
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let emit_app = app.clone();
    let emit_tile_id = tile_id.clone();
    let popup_app = app.clone();
    let popup_label_base = label.clone();
    let is_player = app
        .get_webview("main")
        .and_then(|main| main.url().ok())
        .map(|main| {
            main.origin() == parsed.origin()
                && parsed
                    .query_pairs()
                    .any(|(key, value)| key == "nativePlayer" && value == tile_id)
        })
        .unwrap_or(false);
    let mut builder = tauri::WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed))
        .initialization_script_for_all_frames(include_str!("core/graveyard.js"))
        .initialization_script_for_all_frames(include_str!("core/rtc_meter.js"))
        .initialization_script_for_all_frames(include_str!("core/mixer.js"))
        .initialization_script_for_all_frames(include_str!("core/quality.js"))
        .user_agent(tile_user_agent(mobile))
        .additional_browser_args(crate::SITE_BROWSER_ARGS)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .focused(false)
        .on_document_title_changed(move |_webview, title| {
            let _ = emit_app.emit(
                "tile-title-changed",
                TileTitleChanged {
                    tile_id: emit_tile_id.clone(),
                    title,
                },
            );
        })
        .on_new_window(move |url, _features| {
            let popup_label = tile_popup_label(&popup_label_base);
            if let Some(stale) = popup_app.get_webview_window(&popup_label) {
                let _ = stale.close();
            }
            match tauri::WebviewWindowBuilder::new(
                &popup_app,
                &popup_label,
                tauri::WebviewUrl::External(url),
            )
            .title("Login")
            .inner_size(480.0, 700.0)
            .center()
            .resizable(true)
            .focused(true)
            .user_agent(tile_user_agent(mobile))
            .additional_browser_args(crate::SITE_BROWSER_ARGS)
            .build()
            {
                Ok(window) => tauri::webview::NewWindowResponse::Create { window },
                Err(_) => tauri::webview::NewWindowResponse::Deny,
            }
        });

    if is_player {
        builder = builder
            .initialization_script_for_all_frames(crate::STREAM_FILTER_SCRIPT)
            .initialization_script_for_all_frames(crate::PLAYER_AUTOPLAY_SCRIPT)
            .initialization_script_for_all_frames(crate::PLAYER_WATCHDOG_SCRIPT)
            .initialization_script_for_all_frames(crate::SCREENSHOT_SCRIPT)
            .initialization_script_for_all_frames(crate::INTERACTION_SCRIPT);
    } else {
        // Website tiles: general ad blocking + direct HLS bridge (top frame only).
        builder = builder
            .initialization_script(crate::web_guard::GUARD_SCRIPT)
            .initialization_script(crate::web_guard::site_hls::SITE_HLS_SCRIPT)
            // Sites whose player drops itself to a low quality are held at their best one.
            .initialization_script(include_str!("core/max_quality.js"))
            // The current automatic-fit setting comes first, so a press on play before the
            // page has finished loading already respects it.
            .initialization_script(format!(
                "{}\n{}",
                fit_auto_script(),
                include_str!("core/fit_video.js")
            ))
            .on_page_load(|webview, payload| match payload.event() {
                // A new page starts unfitted, so the app must not keep treating the tile as fitted.
                tauri::webview::PageLoadEvent::Started => {
                    if let Some(tile_id) = webview.label().strip_prefix(TILE_WEBVIEW_PREFIX) {
                        let _ = webview.app_handle().emit(
                            "tile-fit-state",
                            serde_json::json!({ "tileId": tile_id, "state": "off" }),
                        );
                    }
                }
                // Every page the tile loads learns the current automatic-fit setting.
                tauri::webview::PageLoadEvent::Finished => {
                    let _ = webview.eval(fit_auto_script());
                }
            });
    }
    let webview = window
        .add_child(builder, LogicalPosition::new(-10000.0, -10000.0), size)
        .map_err(|e| format!("failed to open tile webview: {e}"))?;
    crate::bandwidth::track(&label);
    #[cfg(windows)]
    if !is_player {
        crate::web_guard::attach::attach(&app, &webview, crate::web_guard::attach::Mode::Website);
    } else if sniff.unwrap_or(false) {
        // Custom-embed players: only note media playlists so they can be recorded.
        crate::web_guard::attach::attach(&app, &webview, crate::web_guard::attach::Mode::SniffOnly);
    }
    #[cfg(windows)]
    crate::bandwidth::attach(&webview);
    #[cfg(not(windows))]
    let _ = sniff;
    webview.hide().map_err(|error| error.to_string())?;
    geometry().bounds.insert(label.clone(), (position, size));
    webview
        .set_position(position)
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if let Err(error) = crate::tile_audio::set_output_muted(&webview, true).await {
        let _ = webview.close();
        return Err(error);
    }
    Ok(label)
}

#[tauri::command]
pub async fn open_player_webview(
    app: AppHandle,
    tile_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    sniff: Option<bool>,
) -> Result<String, String> {
    tile_label(&tile_id)?;
    let mut url = app
        .get_webview("main")
        .ok_or("main webview not found")?
        .url()
        .map_err(|error| error.to_string())?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut().append_pair("nativePlayer", &tile_id);
    let result = open_tile_webview(
        app,
        tile_id.clone(),
        url.to_string(),
        x,
        y,
        width,
        height,
        false,
        sniff,
    )
    .await;
    if let Err(error) = &result {
        log::warn!("open_player_webview {tile_id} failed: {error}");
    }
    result
}

#[tauri::command]
pub async fn close_tile_webview(app: AppHandle, tile_id: String) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    if let Some(popup) = app.get_webview_window(&tile_popup_label(&label)) {
        let _ = popup.close();
    }
    app.state::<crate::web_guard::GuardState>()
        .forget_webview(&label);
    {
        let mut tiles = geometry();
        tiles.bounds.remove(&label);
        tiles.parked.remove(&label);
    }
    crate::bandwidth::forget(&label);
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.hide();
        let _ = webview.eval("window.postMessage({type:'MULTISTREAM_GRAVEYARD_SUSPEND'}, '*')");
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        webview
            .close()
            .map_err(|e| format!("failed to close tile webview: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tile_navigate(app: AppHandle, tile_id: String, url: String) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    let parsed = validate_tile_url(&url)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    webview
        .navigate(parsed)
        .map_err(|e| format!("failed to navigate tile webview: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn tile_reload(app: AppHandle, tile_id: String) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    webview
        .reload()
        .map_err(|e| format!("failed to reload tile webview: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn tile_go_back(app: AppHandle, tile_id: String) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    webview
        .eval("history.back()")
        .map_err(|e| format!("failed to go back in tile webview: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn tile_go_forward(app: AppHandle, tile_id: String) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    webview
        .eval("history.forward()")
        .map_err(|e| format!("failed to go forward in tile webview: {e}"))?;
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileBounds {
    tile_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Moves many tiles in one IPC call and one main-thread hop, so layout animations stay in sync.
/// Returns the ids that were positioned; unknown or invalid tiles are skipped, not fatal.
#[tauri::command]
pub async fn tile_set_bounds_batch(
    app: AppHandle,
    tiles: Vec<TileBounds>,
) -> Result<Vec<String>, String> {
    if tiles.len() > MAX_BATCH {
        return Err("too many tiles".to_string());
    }
    let mut targets = Vec::with_capacity(tiles.len());
    let mut already_applied = Vec::new();
    for tile in tiles {
        let Ok(label) = tile_label(&tile.tile_id) else {
            continue;
        };
        let Ok((position, size)) = validate_tile_bounds(tile.x, tile.y, tile.width, tile.height)
        else {
            continue;
        };
        if let Some(webview) = app.get_webview(&label) {
            let parked = {
                let mut tiles = geometry();
                tiles.bounds.insert(label.clone(), (position, size));
                tiles.parked.contains(&label)
            };
            if parked {
                // Remembered for when it returns; moving it now would uncover it.
                already_applied.push(tile.tile_id);
            } else {
                targets.push((tile.tile_id, webview, position, size));
            }
        }
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let applied = targets
            .into_iter()
            .filter(|(tile_id, webview, position, size)| {
                // A tile parked since this batch was queued must stay out of the way: moving it
                // now would put it back over the grid while the app still treats it as parked.
                if tile_label(tile_id).is_ok_and(|label| geometry().parked.contains(&label)) {
                    return false;
                }
                webview
                    .set_bounds(tauri::Rect {
                        position: (*position).into(),
                        size: (*size).into(),
                    })
                    .is_ok()
            })
            .map(|(tile_id, ..)| tile_id)
            .collect::<Vec<_>>();
        let _ = sender.send(applied);
    })
    .map_err(|error| error.to_string())?;
    let mut applied = receiver
        .await
        .map_err(|_| "tile bounds operation cancelled".to_string())?;
    if !geometry().cutouts.is_empty() {
        for tile_id in &applied {
            if let Ok(label) = tile_label(tile_id) {
                clip_tile(&app, &label);
            }
        }
    }
    applied.extend(already_applied);
    Ok(applied)
}

/// `park` keeps the page rendering (so video keeps playing) while moving the native view out of
/// the way. A hidden WebView2 stops playback, which is why dialogs park tiles instead of hiding.
#[tauri::command]
pub async fn tile_set_visible(
    app: AppHandle,
    tile_id: String,
    visible: bool,
    park: Option<bool>,
) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    if visible {
        let restore = {
            let mut tiles = geometry();
            if tiles.parked.remove(&label) {
                tiles.bounds.get(&label).copied()
            } else {
                None
            }
        };
        if let Some((position, size)) = restore {
            webview
                .set_bounds(tauri::Rect {
                    position: position.into(),
                    size: size.into(),
                })
                .map_err(|e| format!("failed to restore tile webview: {e}"))?;
        }
        webview
            .show()
            .map_err(|e| format!("failed to show tile webview: {e}"))?;
        clip_tile(&app, &label);
    } else if park.unwrap_or(false) {
        geometry().parked.insert(label);
        webview
            .show()
            .map_err(|e| format!("failed to show tile webview: {e}"))?;
        webview
            .set_position(LogicalPosition::new(PARK_POSITION, PARK_POSITION))
            .map_err(|e| format!("failed to park tile webview: {e}"))?;
    } else {
        webview
            .hide()
            .map_err(|e| format!("failed to hide tile webview: {e}"))?;
    }
    Ok(())
}

/// The part of a tile the cutout removes, in the tile's own physical pixels:
/// (tile width, tile height, hole left, top, right, bottom). None when they do not overlap.
fn cutout_hole(
    cut: CutoutRect,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
    scale: f64,
) -> Option<(i32, i32, i32, i32, i32, i32)> {
    let width = (size.width * scale).round() as i32;
    let height = (size.height * scale).round() as i32;
    let left = (((cut.x - position.x) * scale).round() as i32).max(0);
    let top = (((cut.y - position.y) * scale).round() as i32).max(0);
    let right = (((cut.x + cut.width - position.x) * scale).round() as i32).min(width);
    let bottom = (((cut.y + cut.height - position.y) * scale).round() as i32).min(height);
    (left < right && top < bottom).then_some((width, height, left, top, right, bottom))
}

/// Clips a tile's native window so the cutout area shows what is underneath (the dialog)
/// while the rest of the tile keeps playing in view.
#[cfg(windows)]
fn clip_tile(app: &AppHandle, label: &str) {
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_DIFF,
    };

    let Some(webview) = app.get_webview(label) else {
        return;
    };
    let scale = app
        .get_window("main")
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    let label = label.to_string();
    let _ = webview.with_webview(move |platform| unsafe {
        // Read the geometry here, on the main thread, so concurrent clips apply in order and the
        // newest cutout always wins instead of a stale one overwriting it.
        let (cutouts, bounds) = {
            let tiles = geometry();
            (tiles.cutouts.clone(), tiles.bounds.get(&label).copied())
        };
        let holes = match bounds {
            Some((position, size)) => cutouts
                .iter()
                .filter_map(|cut| cutout_hole(*cut, position, size, scale))
                .collect::<Vec<_>>(),
            None => Vec::new(),
        };
        let mut container = Default::default();
        if platform.controller().ParentWindow(&mut container).is_err() {
            return;
        }
        let window = container.0 as isize;
        match holes.first() {
            Some(&(width, height, ..)) => {
                let region = CreateRectRgn(0, 0, width, height);
                for (.., left, top, right, bottom) in holes {
                    let cut = CreateRectRgn(left, top, right, bottom);
                    CombineRgn(region, region, cut, RGN_DIFF);
                    DeleteObject(cut);
                }
                // The window owns the region once it is set; free it ourselves if that failed.
                if SetWindowRgn(window, region, 1) == 0 {
                    DeleteObject(region);
                }
            }
            None => {
                SetWindowRgn(window, 0, 1);
            }
        }
    });
}

#[cfg(not(windows))]
fn clip_tile(_app: &AppHandle, _label: &str) {}

/// Lets an open dialog show through the native tiles instead of hiding them, so streams stay
/// visible and playing. Returns false where this cannot be done (the caller then parks tiles).
#[tauri::command]
pub async fn tiles_set_cutout(app: AppHandle, rects: Vec<CutoutRect>) -> Result<bool, String> {
    if !cfg!(windows) {
        return Ok(false);
    }
    for cut in &rects {
        if ![cut.x, cut.y, cut.width, cut.height]
            .iter()
            .all(|v| v.is_finite())
        {
            return Err("cutout bounds must be finite numbers".to_string());
        }
    }
    let labels = {
        let mut tiles = geometry();
        tiles.cutouts = rects;
        tiles.bounds.keys().cloned().collect::<Vec<_>>()
    };
    for label in labels {
        clip_tile(&app, &label);
    }
    Ok(true)
}

/// Cursor position and left-button state while a tile is being dragged, in logical pixels
/// relative to the main window's page.
#[derive(serde::Serialize, Clone)]
struct DragPointer {
    x: f64,
    y: f64,
    down: bool,
}

static DRAG_WATCH: AtomicU64 = AtomicU64::new(0);
const DRAG_WATCH_MAX: Duration = Duration::from_secs(120);

/// Reports the cursor while a tile is dragged. A tile (a separate native window) under the cursor
/// swallows mouse events, so the page cannot see where the drag is or when it ends; the cursor is
/// read from the OS instead, and the tiles stay untouched, visible and playing.
///
/// Deliberately a synchronous command: those run in the order the page sent them, so a quick
/// stop-then-start can never be reordered into a start that the stale stop immediately ends.
#[tauri::command]
pub fn drag_pointer_watch(app: AppHandle, active: bool) -> Result<(), String> {
    // Starting a new watch (or stopping) ends any earlier one.
    let generation = DRAG_WATCH.fetch_add(1, Ordering::SeqCst) + 1;
    if active && cfg!(windows) {
        std::thread::spawn(move || watch_drag_pointer(app, generation));
    }
    Ok(())
}

#[cfg(windows)]
fn watch_drag_pointer(app: AppHandle, generation: u64) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetSystemMetrics, SM_SWAPBUTTON,
    };

    // GetAsyncKeyState reads physical buttons; with swapped buttons the primary (dragging) one
    // is the physical right button.
    // SAFETY: plain Win32 query without pointers.
    let primary = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
        VK_RBUTTON
    } else {
        VK_LBUTTON
    };
    let started = Instant::now();
    while DRAG_WATCH.load(Ordering::SeqCst) == generation && started.elapsed() < DRAG_WATCH_MAX {
        let Some(window) = app.get_window("main") else {
            return;
        };
        let (Ok(origin), Ok(scale)) = (window.inner_position(), window.scale_factor()) else {
            return;
        };
        let mut point = POINT { x: 0, y: 0 };
        // SAFETY: plain Win32 reads into a local struct.
        let (read, down) = unsafe {
            (
                GetCursorPos(&mut point) != 0,
                GetAsyncKeyState(i32::from(primary)) < 0,
            )
        };
        if read {
            let _ = app.emit_to(
                "main",
                "drag-pointer",
                DragPointer {
                    x: f64::from(point.x - origin.x) / scale,
                    y: f64::from(point.y - origin.y) / scale,
                    down,
                },
            );
        }
        if !down {
            return;
        }
        std::thread::sleep(Duration::from_millis(16));
    }
}

#[cfg(not(windows))]
fn watch_drag_pointer(_app: AppHandle, _generation: u64) {}

static FIT_AUTO: AtomicBool = AtomicBool::new(true);

fn fit_auto_script() -> &'static str {
    if FIT_AUTO.load(Ordering::Relaxed) {
        "window.__MS_FIT_AUTO=true;"
    } else {
        "window.__MS_FIT_AUTO=false;"
    }
}

/// Fits (or releases) the main video of a website tile. `mode` is "toggle" or "exit".
#[tauri::command]
pub async fn tile_fit_video(app: AppHandle, tile_id: String, mode: String) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    let script = match mode.as_str() {
        "toggle" => "window.__msFit&&window.__msFit.toggle()",
        "exit" => "window.__msFit&&window.__msFit.exit()",
        _ => return Err("unknown fit mode".to_string()),
    };
    webview
        .eval(script)
        .map_err(|e| format!("failed to fit tile video: {e}"))
}

/// Turns the automatic fit-on-play behaviour on or off for every open website tile.
#[tauri::command]
pub async fn tile_fit_auto(app: AppHandle, enabled: bool) -> Result<(), String> {
    FIT_AUTO.store(enabled, Ordering::Relaxed);
    let labels = geometry().bounds.keys().cloned().collect::<Vec<_>>();
    for label in labels {
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.eval(fit_auto_script());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn tile_current_url(app: AppHandle, tile_id: String) -> Result<String, String> {
    let label = tile_label(&tile_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    webview
        .url()
        .map(|url| url.to_string())
        .map_err(|e| format!("failed to read tile webview url: {e}"))
}

fn validate_quality(quality: &str) -> Result<(), String> {
    if quality.is_empty()
        || quality.len() > 80
        || !quality
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_:.-".contains(c))
    {
        return Err("invalid stream quality".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn tile_set_quality(
    app: AppHandle,
    tile_id: String,
    quality: String,
) -> Result<(), String> {
    validate_quality(&quality)?;
    let label = tile_label(&tile_id)?;
    let view = app.get_webview(&label).ok_or("tile webview not found")?;
    let value = serde_json::to_string(&quality).map_err(|error| error.to_string())?;
    view.eval(format!(
        "window.postMessage({{type:'MULTISTREAM_QUALITY_REQUEST',quality:{value}}},'*')"
    ))
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn tile_set_audio(
    app: AppHandle,
    tile_id: String,
    volume: f64,
    muted: bool,
) -> Result<(), String> {
    let page_volume = crate::tile_audio::page_volume(volume)?;
    let label = tile_label(&tile_id)?;
    let webview = app.get_webview(&label).ok_or("tile webview not found")?;
    crate::tile_audio::set_output_muted(&webview, muted || volume == 0.0).await?;
    if let Some(volume) = page_volume {
        webview
            .eval(format!(
                "window.postMessage({{type:'MULTISTREAM_MIXER_VOLUME',volume:{volume}}},'*')"
            ))
            .map_err(|e| format!("failed to set tile volume: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_quality_ids_before_evaluation() {
        // Arrange
        let valid = ["auto", "720p60", "hd1080", "native-0"];
        let invalid = ["", "');alert(1)//", "a b", "https://evil", &"a".repeat(81)];
        // Act
        let good = valid.map(validate_quality);
        let bad = invalid.map(validate_quality);
        // Assert
        assert!(good.iter().all(Result::is_ok));
        assert!(bad.iter().all(Result::is_err));
    }

    #[test]
    fn accepts_uuid_tile_ids() {
        // Arrange
        let id = "550e8400-e29b-41d4-a716-446655440000";

        // Act
        let result = tile_label(id);

        // Assert
        assert_eq!(
            result,
            Ok("tile-550e8400-e29b-41d4-a716-446655440000".to_string())
        );
    }

    #[test]
    fn rejects_tile_ids_with_unsafe_chars_or_bad_length() {
        // Arrange
        let bad = ["", "a/b", "a b", "<script>", &"a".repeat(41)];

        // Act
        let results: Vec<_> = bad.iter().map(|id| tile_label(id)).collect();

        // Assert
        assert!(results.iter().all(|r| r.is_err()));
    }

    #[test]
    fn accepts_http_and_https_tile_urls() {
        // Arrange
        let urls = [
            "https://www.google.com/search?q=cats",
            "http://localhost:5174/",
        ];

        // Act
        let results: Vec<_> = urls.iter().map(|u| validate_tile_url(u)).collect();

        // Assert
        assert!(results.iter().all(|r| r.is_ok()));
    }

    #[test]
    fn rejects_non_http_tile_urls_and_garbage() {
        // Arrange
        let urls = [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "tauri://localhost",
            "not a url",
        ];

        // Act
        let results: Vec<_> = urls.iter().map(|u| validate_tile_url(u)).collect();

        // Assert
        assert!(results.iter().all(|r| r.is_err()));
    }

    #[test]
    fn accepts_sane_bounds() {
        // Arrange
        let (x, y, w, h) = (10.0, 20.5, 640.0, 360.0);

        // Act
        let result = validate_tile_bounds(x, y, w, h);

        // Assert
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_non_finite_or_empty_bounds() {
        // Arrange
        let cases = [
            (f64::NAN, 0.0, 10.0, 10.0),
            (0.0, f64::INFINITY, 10.0, 10.0),
            (0.0, 0.0, 0.0, 10.0),
            (0.0, 0.0, 10.0, -5.0),
        ];

        // Act
        let results: Vec<_> = cases
            .iter()
            .map(|(x, y, w, h)| validate_tile_bounds(*x, *y, *w, *h))
            .collect();

        // Assert
        assert!(results.iter().all(|r| r.is_err()));
    }

    #[test]
    fn selects_desktop_user_agent_by_default() {
        // Arrange
        let mobile = false;

        // Act
        let agent = tile_user_agent(mobile);

        // Assert
        assert_eq!(agent, crate::USER_AGENT);
        assert!(!agent.contains("Mobile"));
    }

    #[test]
    fn selects_mobile_user_agent_for_mobile_view() {
        // Arrange
        let mobile = true;

        // Act
        let agent = tile_user_agent(mobile);

        // Assert
        assert_eq!(agent, crate::MOBILE_USER_AGENT);
        assert!(agent.contains("Mobile"));
    }

    #[test]
    fn derives_popup_label_from_tile_label() {
        // Arrange
        let label = "tile-abc123";

        // Act
        let popup = tile_popup_label(label);

        // Assert
        assert_eq!(popup, "tile-abc123-popup");
    }
}

#[cfg(test)]
mod cutout_tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> CutoutRect {
        CutoutRect {
            x,
            y,
            width,
            height,
        }
    }
    fn tile() -> (LogicalPosition<f64>, LogicalSize<f64>) {
        (
            LogicalPosition::new(100.0, 50.0),
            LogicalSize::new(400.0, 300.0),
        )
    }

    #[test]
    fn hole_is_relative_to_the_tile() {
        let (position, size) = tile();
        let hole = cutout_hole(rect(150.0, 100.0, 100.0, 100.0), position, size, 1.0);
        assert_eq!(hole, Some((400, 300, 50, 50, 150, 150)));
    }

    #[test]
    fn hole_scales_with_the_display() {
        let (position, size) = tile();
        let hole = cutout_hole(rect(150.0, 100.0, 100.0, 100.0), position, size, 1.5);
        assert_eq!(hole, Some((600, 450, 75, 75, 225, 225)));
    }

    #[test]
    fn hole_is_clamped_to_the_tile() {
        let (position, size) = tile();
        let hole = cutout_hole(rect(0.0, 0.0, 1000.0, 1000.0), position, size, 1.0);
        assert_eq!(hole, Some((400, 300, 0, 0, 400, 300)));
    }

    #[test]
    fn tiles_outside_the_cutout_are_untouched() {
        let (position, size) = tile();
        assert_eq!(
            cutout_hole(rect(600.0, 50.0, 100.0, 100.0), position, size, 1.0),
            None
        );
        assert_eq!(
            cutout_hole(rect(100.0, 400.0, 100.0, 100.0), position, size, 1.0),
            None
        );
        assert_eq!(
            cutout_hole(rect(150.0, 100.0, 0.0, 0.0), position, size, 1.0),
            None
        );
    }
}
