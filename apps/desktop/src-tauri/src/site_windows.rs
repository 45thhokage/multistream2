use tauri::{AppHandle, Manager};

pub(crate) const SITE_WINDOW_PREFIX: &str = "site-";
const MAX_LABEL_LEN: usize = 40;
const MAX_TITLE_CHARS: usize = 80;

fn validate_site_label(label: &str) -> Result<(), String> {
    let rest = label
        .strip_prefix(SITE_WINDOW_PREFIX)
        .ok_or_else(|| "site window label must start with 'site-'".to_string())?;
    if rest.is_empty()
        || rest.len() > MAX_LABEL_LEN
        || !rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid site window label".to_string());
    }
    Ok(())
}

fn validate_site_url(raw: &str) -> Result<tauri::Url, String> {
    let parsed = raw
        .parse::<tauri::Url>()
        .map_err(|_| "invalid site url".to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("only http(s) site urls are allowed".to_string()),
    }
}

fn display_title(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "Site".to_string();
    }
    trimmed.chars().take(MAX_TITLE_CHARS).collect()
}

#[derive(serde::Serialize)]
pub struct SiteWindowInfo {
    pub label: String,
    pub title: String,
}

#[tauri::command]
pub async fn open_site_window(
    app: AppHandle,
    label: String,
    url: String,
    title: String,
) -> Result<String, String> {
    validate_site_label(&label)?;
    let parsed = validate_site_url(&url)?;

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(label);
    }

    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed))
        .title(display_title(&title))
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .visible(true)
        .user_agent(crate::USER_AGENT)
        .additional_browser_args(crate::SITE_BROWSER_ARGS)
        .build()
        .map_err(|e| format!("failed to open site window: {e}"))?;
    Ok(label)
}

#[tauri::command]
pub async fn close_site_window(app: AppHandle, label: String) -> Result<(), String> {
    validate_site_label(&label)?;
    if let Some(window) = app.get_webview_window(&label) {
        window
            .close()
            .map_err(|e| format!("failed to close site window: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_site_windows(app: AppHandle) -> Vec<SiteWindowInfo> {
    app.webview_windows()
        .values()
        .filter_map(|window| {
            let label = window.label().to_string();
            if !label.starts_with(SITE_WINDOW_PREFIX) {
                return None;
            }
            Some(SiteWindowInfo {
                label,
                title: window.title().unwrap_or_default(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_well_formed_label() {
        assert!(validate_site_label("site-abc123_X-9").is_ok());
    }

    #[test]
    fn rejects_label_without_prefix() {
        assert!(validate_site_label("main").is_err());
        assert!(validate_site_label("website-abc").is_err());
    }

    #[test]
    fn rejects_label_with_unsafe_chars_or_bad_length() {
        assert!(validate_site_label("site-").is_err());
        assert!(validate_site_label("site-a/b").is_err());
        assert!(validate_site_label("site-a b").is_err());
        assert!(validate_site_label("site-<script>").is_err());
        assert!(validate_site_label(&format!("site-{}", "a".repeat(41))).is_err());
    }

    #[test]
    fn accepts_http_and_https_urls() {
        assert!(validate_site_url("https://github.com").is_ok());
        assert!(validate_site_url("http://localhost:5174").is_ok());
    }

    #[test]
    fn rejects_non_http_urls_and_garbage() {
        assert!(validate_site_url("javascript:alert(1)").is_err());
        assert!(validate_site_url("file:///etc/passwd").is_err());
        assert!(validate_site_url("tauri://localhost").is_err());
        assert!(validate_site_url("not a url").is_err());
    }

    #[test]
    fn falls_back_to_generic_title_when_blank() {
        assert_eq!(display_title("  "), "Site");
        assert_eq!(display_title("GitHub"), "GitHub");
    }
}
