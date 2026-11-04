use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager};

pub(crate) const TILE_WEBVIEW_PREFIX: &str = "tile-";
const MAX_ID_LEN: usize = 40;

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
) -> Result<String, String> {
    let label = tile_label(&tile_id)?;
    let parsed = validate_tile_url(&url)?;
    let (position, size) = validate_tile_bounds(x, y, width, height)?;

    if let Some(existing) = app.get_webview(&label) {
        let _ = existing.set_position(position);
        let _ = existing.set_size(size);
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
            .initialization_script_for_all_frames(crate::SCREENSHOT_SCRIPT)
            .initialization_script_for_all_frames(crate::KEYBOARD_SCRIPT);
    }
    let webview = window
        .add_child(builder, LogicalPosition::new(-10000.0, -10000.0), size)
        .map_err(|e| format!("failed to open tile webview: {e}"))?;
    webview.hide().map_err(|error| error.to_string())?;
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
    open_tile_webview(app, tile_id, url.to_string(), x, y, width, height, false).await
}

#[tauri::command]
pub async fn close_tile_webview(app: AppHandle, tile_id: String) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    if let Some(popup) = app.get_webview_window(&tile_popup_label(&label)) {
        let _ = popup.close();
    }
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

#[tauri::command]
pub async fn tile_set_bounds(
    app: AppHandle,
    tile_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    let (position, size) = validate_tile_bounds(x, y, width, height)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    webview
        .set_position(position)
        .map_err(|e| format!("failed to position tile webview: {e}"))?;
    webview
        .set_size(size)
        .map_err(|e| format!("failed to size tile webview: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn tile_set_visible(
    app: AppHandle,
    tile_id: String,
    visible: bool,
) -> Result<(), String> {
    let label = tile_label(&tile_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "tile webview not found".to_string())?;
    if visible {
        webview
            .show()
            .map_err(|e| format!("failed to show tile webview: {e}"))?;
    } else {
        webview
            .hide()
            .map_err(|e| format!("failed to hide tile webview: {e}"))?;
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
