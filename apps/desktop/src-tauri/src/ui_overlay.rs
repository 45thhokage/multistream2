use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Listener, LogicalPosition, LogicalSize, Manager, Webview};

const LABEL: &str = "ui-overlay";
const OFFSCREEN: f64 = -10000.0;

struct Pending {
    generation: u64,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
}

static GENERATION: AtomicU64 = AtomicU64::new(0);
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static CREATE_LOCK: Mutex<()> = Mutex::new(());
static CONTENT: Mutex<Option<serde_json::Value>> = Mutex::new(None);

fn pending() -> std::sync::MutexGuard<'static, Option<Pending>> {
    PENDING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn host_url(mut url: tauri::Url) -> tauri::Url {
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut().append_pair("nativeOverlay", "host");
    url
}

fn validate_content(
    kind: &str,
    data: &str,
) -> Result<std::collections::HashMap<String, String>, String> {
    if !matches!(kind, "layout" | "preview") || data.len() > 8192 {
        return Err("invalid overlay content".into());
    }
    serde_json::from_str(data).map_err(|_| "invalid overlay data".into())
}

// One long-lived hidden webview: creating a webview per open reloads the whole app each time.
fn ensure_overlay(app: &AppHandle) -> Result<Webview, String> {
    let _guard = CREATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(view) = app.get_webview(LABEL) {
        return Ok(view);
    }
    let main = app.get_webview("main").ok_or("main webview not found")?;
    let url = host_url(main.url().map_err(|error| error.to_string())?);
    let window = app.get_window("main").ok_or("main window not found")?;
    let builder = tauri::WebviewBuilder::new(LABEL, tauri::WebviewUrl::External(url))
        .user_agent(crate::USER_AGENT)
        .additional_browser_args(crate::SITE_BROWSER_ARGS)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .focused(false);
    let view = window
        .add_child(
            builder,
            LogicalPosition::new(OFFSCREEN, OFFSCREEN),
            LogicalSize::new(8.0, 8.0),
        )
        .map_err(|error| error.to_string())?;
    view.hide().map_err(|error| error.to_string())?;
    Ok(view)
}

// Child webviews stack in creation order and showing one never changes that, so tiles opened
// after the overlay would cover it. Raise its container window every time it is shown.
#[cfg(windows)]
fn bring_to_front(view: &Webview) {
    let _ = view.with_webview(|platform| unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        let mut container = Default::default();
        if platform.controller().ParentWindow(&mut container).is_ok() {
            SetWindowPos(
                container.0 as isize,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    });
}

#[cfg(not(windows))]
fn bring_to_front(_view: &Webview) {}

pub fn init(app: &AppHandle) {
    let ready_app = app.clone();
    app.listen("ui-overlay-ready", move |_| {
        if let Some(content) = CONTENT
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
        {
            let _ = ready_app.emit_to(LABEL, "ui-overlay-content", content);
        }
    });
    let rendered_app = app.clone();
    app.listen("ui-overlay-rendered", move |event| {
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
            return;
        };
        let Some(generation) = payload.get("generation").and_then(|value| value.as_u64()) else {
            return;
        };
        let Some((position, size)) = pending()
            .as_ref()
            .filter(|p| p.generation == generation)
            .map(|p| (p.position, p.size))
        else {
            return;
        };
        if let Some(view) = rendered_app.get_webview(LABEL) {
            let _ = view.set_size(size);
            let _ = view.set_position(position);
            bring_to_front(&view);
            if let Err(error) = view.show() {
                log::warn!("ui-overlay: failed to show: {error}");
            }
        }
    });
}

#[tauri::command]
pub async fn close_ui_overlay(app: AppHandle) -> Result<(), String> {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    *pending() = None;
    *CONTENT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    if let Some(view) = app.get_webview(LABEL) {
        let _ = app.emit_to(LABEL, "ui-overlay-reset", ());
        view.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn prewarm_ui_overlay(app: AppHandle) -> Result<(), String> {
    let result = ensure_overlay(&app).map(|_| ());
    if let Err(error) = &result {
        log::warn!("ui-overlay: prewarm failed: {error}");
    }
    result
}

#[tauri::command]
pub async fn open_ui_overlay(
    app: AppHandle,
    kind: String,
    data: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (position, size) = crate::browser_tiles::validate_tile_bounds(x, y, width, height)?;
    let fields = validate_content(&kind, &data)?;
    if let Err(error) = ensure_overlay(&app) {
        log::warn!("ui-overlay: failed to create: {error}");
        let _ = close_ui_overlay(app.clone()).await;
        return Err(error);
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let content = serde_json::json!({ "generation": generation, "kind": kind, "data": fields });
    *pending() = Some(Pending {
        generation,
        position,
        size,
    });
    *CONTENT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(content.clone());
    app.emit_to(LABEL, "ui-overlay-content", content)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_host_url_from_local_origin() {
        // Arrange
        let main = "http://localhost:5174/?old=1#x".parse().unwrap();
        // Act
        let url = host_url(main);
        // Assert
        assert_eq!(url.origin().ascii_serialization(), "http://localhost:5174");
        assert_eq!(url.query(), Some("nativeOverlay=host"));
        assert_eq!(url.fragment(), None);
    }

    #[test]
    fn rejects_unknown_kind_or_invalid_payload() {
        // Arrange
        let invalid_object = "[]";
        // Act
        let kind = validate_content("https://other.site", "{}");
        let data = validate_content("layout", invalid_object);
        let valid = validate_content("preview", r#"{"title":"a&b"}"#);
        // Assert
        assert!(kind.is_err());
        assert!(data.is_err());
        assert_eq!(valid.unwrap()["title"], "a&b");
    }
}
