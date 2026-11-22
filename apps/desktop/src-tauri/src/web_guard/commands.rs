//! IPC commands for website ad blocking, detected media, direct HLS and diagnostics.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::diagnostics::{BlockedEvent, DetectedMedia, SiteHlsStatus};
use super::filters::{self, FilterConfig};
use super::GuardState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdblockState {
    pub config: FilterConfig,
    pub updating: bool,
    pub total_rules: usize,
    pub engine_ready: bool,
    pub engine_built_at: Option<i64>,
    pub engine_error: Option<String>,
    pub last_update_check: Option<i64>,
    pub blocked_total: u64,
}

fn snapshot(state: &GuardState) -> Result<AdblockState, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?.clone();
    let diag = state.diag.lock().map_err(|e| e.to_string())?;
    Ok(AdblockState {
        config,
        updating: state.updating.load(std::sync::atomic::Ordering::SeqCst),
        total_rules: diag.engine_rules,
        engine_ready: state.has_engine(),
        engine_built_at: diag.engine_built_at,
        engine_error: diag.engine_error.clone(),
        last_update_check: diag.last_update_check,
        blocked_total: diag.blocked_total,
    })
}

/// Applies `change` to the stored config, saves it and tells every window.
fn mutate(
    app: &AppHandle,
    change: impl FnOnce(&mut FilterConfig) -> Result<(), String>,
) -> Result<(), String> {
    let state = app.state::<GuardState>();
    {
        let mut config = state.config.lock().map_err(|e| e.to_string())?;
        change(&mut config)?;
        config.normalize();
        filters::save_config(&config)?;
    }
    let _ = app.emit("adblock-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn adblock_get_state(state: State<'_, GuardState>) -> Result<AdblockState, String> {
    snapshot(&state)
}

#[tauri::command]
pub async fn adblock_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    mutate(&app, |c| {
        c.enabled = enabled;
        Ok(())
    })
}

#[tauri::command]
pub async fn adblock_set_auto_update(
    app: AppHandle,
    enabled: bool,
    interval_hours: u32,
) -> Result<(), String> {
    mutate(&app, |c| {
        c.auto_update = enabled;
        c.update_interval_hours = interval_hours;
        Ok(())
    })?;
    if enabled {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = super::update_lists(&app, false).await;
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn adblock_set_list_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    mutate(&app, |c| {
        let list = c
            .lists
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or_else(|| "Unknown filter list".to_string())?;
        list.enabled = enabled;
        Ok(())
    })?;
    // Downloads it if it has never been fetched, then rebuilds either way.
    let changed = super::update_lists(&app, false).await.unwrap_or(0);
    if changed == 0 {
        super::rebuild(&app).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn adblock_add_list(app: AppHandle, name: String, url: String) -> Result<(), String> {
    mutate(&app, |c| {
        filters::add_custom_list(c, &name, &url).map(|_| ())
    })?;
    let _ = super::update_lists(&app, false).await;
    Ok(())
}

#[tauri::command]
pub async fn adblock_remove_list(app: AppHandle, id: String) -> Result<(), String> {
    mutate(&app, |c| {
        let index = c
            .lists
            .iter()
            .position(|l| l.id == id)
            .ok_or_else(|| "Unknown filter list".to_string())?;
        if c.lists[index].builtin {
            return Err("Built-in lists can be switched off but not removed".into());
        }
        c.lists.remove(index);
        Ok(())
    })?;
    filters::remove_list_file(&id);
    super::rebuild(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn adblock_update_now(app: AppHandle) -> Result<usize, String> {
    super::update_lists(&app, true).await
}

#[tauri::command]
pub async fn adblock_set_custom_rules(app: AppHandle, rules: String) -> Result<(), String> {
    mutate(&app, |c| {
        c.custom_rules = rules;
        Ok(())
    })?;
    super::rebuild(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn adblock_allowlist_add(app: AppHandle, host: String) -> Result<String, String> {
    let host = filters::normalize_host(&host)
        .ok_or_else(|| "Enter a site such as example.com".to_string())?;
    let added = host.clone();
    mutate(&app, |c| {
        if !c.allowlist.contains(&host) {
            c.allowlist.push(host);
        }
        Ok(())
    })?;
    Ok(added)
}

#[tauri::command]
pub async fn adblock_allowlist_remove(app: AppHandle, host: String) -> Result<(), String> {
    mutate(&app, |c| {
        c.allowlist.retain(|h| h != &host);
        Ok(())
    })
}

#[tauri::command]
pub async fn tile_media_list(
    state: State<'_, GuardState>,
    tile_id: String,
) -> Result<Vec<DetectedMedia>, String> {
    let label = format!("{}{tile_id}", crate::browser_tiles::TILE_WEBVIEW_PREFIX);
    let diag = state.diag.lock().map_err(|e| e.to_string())?;
    Ok(diag.media_for(&label))
}

#[tauri::command]
pub async fn site_hls_set(app: AppHandle, tile_id: String, enabled: bool) -> Result<(), String> {
    let label = format!("{}{tile_id}", crate::browser_tiles::TILE_WEBVIEW_PREFIX);
    if app.get_webview(&label).is_none() {
        return Err("website tile is not open".into());
    }
    {
        let state = app.state::<GuardState>();
        let mut direct = state.hls_direct.lock().map_err(|e| e.to_string())?;
        if enabled {
            direct.insert(label.clone());
        } else {
            direct.remove(&label);
        }
    }
    if !cfg!(windows) && enabled {
        return Err("Direct stream playback needs the Windows desktop build".into());
    }
    super::site_hls::apply(&app, &label, enabled);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewDiagnostics {
    pub webview: String,
    pub tile_id: String,
    pub blocked: u64,
    pub media: Vec<DetectedMedia>,
    pub site_hls: Option<SiteHlsStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub generated_at: i64,
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub adblock: AdblockState,
    pub blocked_by_list: Vec<(String, u64)>,
    pub recent_blocked: Vec<BlockedEvent>,
    pub webviews: Vec<WebviewDiagnostics>,
    pub engine_build_ms: Option<u64>,
}

#[tauri::command]
pub async fn diagnostics_snapshot(app: AppHandle) -> Result<DiagnosticsSnapshot, String> {
    let state = app.state::<GuardState>();
    let adblock = snapshot(&state)?;
    let diag = state.diag.lock().map_err(|e| e.to_string())?;
    let mut labels: Vec<String> = diag
        .media
        .keys()
        .chain(diag.blocked_by_webview.keys())
        .chain(diag.site_hls.keys())
        .cloned()
        .collect();
    for webview in app.webviews().keys() {
        if webview.starts_with(crate::browser_tiles::TILE_WEBVIEW_PREFIX)
            || webview.starts_with(crate::site_windows::SITE_WINDOW_PREFIX)
        {
            labels.push(webview.clone());
        }
    }
    labels.sort();
    labels.dedup();
    let webviews = labels
        .into_iter()
        .map(|label| WebviewDiagnostics {
            tile_id: super::tile_id_of(&label).to_string(),
            blocked: diag.blocked_by_webview.get(&label).copied().unwrap_or(0),
            media: diag.media_for(&label),
            site_hls: diag.site_hls.get(&label).cloned(),
            webview: label,
        })
        .collect();
    let mut blocked_by_list: Vec<(String, u64)> = diag
        .blocked_by_list
        .iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    blocked_by_list.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    Ok(DiagnosticsSnapshot {
        generated_at: chrono::Utc::now().timestamp_millis(),
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        adblock,
        blocked_by_list,
        recent_blocked: diag.blocked.iter().rev().cloned().collect(),
        webviews,
        engine_build_ms: diag.engine_build_ms,
    })
}

#[tauri::command]
pub async fn diagnostics_clear(state: State<'_, GuardState>) -> Result<(), String> {
    state.diag.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}
