use tauri::{AppHandle, LogicalPosition, Manager};

fn overlay_url(mut url: tauri::Url, kind: &str, data: &str) -> Result<tauri::Url, String> {
    if !matches!(kind, "layout" | "preview") || data.len() > 8192 {
        return Err("invalid overlay content".into());
    }
    let _: std::collections::HashMap<String, String> =
        serde_json::from_str(data).map_err(|_| "invalid overlay data")?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut()
        .append_pair("nativeOverlay", kind)
        .append_pair("data", data);
    Ok(url)
}

#[tauri::command]
pub async fn close_ui_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(view) = app.get_webview("ui-overlay") {
        view.close().map_err(|error| error.to_string())?;
    }
    Ok(())
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
    let main = app.get_webview("main").ok_or("main webview not found")?;
    let url = overlay_url(main.url().map_err(|error| error.to_string())?, &kind, &data)?;
    close_ui_overlay(app.clone()).await?;
    let window = app.get_window("main").ok_or("main window not found")?;
    let builder =
        tauri::WebviewBuilder::new("ui-overlay", tauri::WebviewUrl::External(url)).focused(false);
    let view = window
        .add_child(builder, LogicalPosition::new(position.x, position.y), size)
        .map_err(|error| error.to_string())?;
    view.show().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_overlay_from_local_origin_and_encodes_data() {
        // Arrange
        let main = "http://localhost:5174/?old=1#x".parse().unwrap();
        // Act
        let url = overlay_url(main, "preview", r#"{"title":"a&b"}"#).unwrap();
        // Assert
        assert_eq!(url.origin().ascii_serialization(), "http://localhost:5174");
        assert_eq!(
            url.query_pairs().find(|(k, _)| k == "data").unwrap().1,
            r#"{"title":"a&b"}"#
        );
        assert_eq!(url.fragment(), None);
    }

    #[test]
    fn rejects_unknown_kind_or_invalid_payload() {
        // Arrange
        let main: tauri::Url = "http://localhost:5174".parse().unwrap();
        // Act
        let kind = overlay_url(main.clone(), "https://other.site", "{}");
        let data = overlay_url(main, "layout", "[]");
        // Assert
        assert!(kind.is_err());
        assert!(data.is_err());
    }
}
