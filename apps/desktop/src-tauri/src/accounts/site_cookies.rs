//! Website sign-in profiles: save a site's cookies under a name and restore them.
//! Every WebView in the app shares one WebView2 profile, so restoring a profile
//! switches the sign-in for all tiles and windows on that site.

use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{take_pwstr, GetCookiesCompletedHandler};
use windows_core::{Interface, BOOL, HSTRING, PWSTR};

use super::store::{cookie_belongs, site_domain, AccountStore, SavedCookie, SiteAccount};
use super::{site_view, SiteAccountView};

const MAX_COOKIES_PER_PROFILE: usize = 400;

fn read_string(f: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>) -> String {
    let mut raw = PWSTR::null();
    if f(&mut raw).is_ok() {
        take_pwstr(raw)
    } else {
        String::new()
    }
}

unsafe fn to_saved(cookie: &ICoreWebView2Cookie) -> SavedCookie {
    let mut expires = 0f64;
    let mut http_only = BOOL::default();
    let mut secure = BOOL::default();
    let mut session = BOOL::default();
    let mut same_site = COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX;
    let _ = cookie.Expires(&mut expires);
    let _ = cookie.IsHttpOnly(&mut http_only);
    let _ = cookie.IsSecure(&mut secure);
    let _ = cookie.IsSession(&mut session);
    let _ = cookie.SameSite(&mut same_site);
    SavedCookie {
        name: read_string(|p| cookie.Name(p)),
        value: read_string(|p| cookie.Value(p)),
        domain: read_string(|p| cookie.Domain(p)),
        path: read_string(|p| cookie.Path(p)),
        expires: if session.as_bool() {
            None
        } else {
            Some(expires)
        },
        http_only: http_only.as_bool(),
        secure: secure.as_bool(),
        same_site: same_site.0,
    }
}

unsafe fn cookie_manager(
    platform: &tauri::webview::PlatformWebview,
) -> windows_core::Result<ICoreWebView2CookieManager> {
    platform
        .controller()
        .CoreWebView2()?
        .cast::<ICoreWebView2_2>()?
        .CookieManager()
}

fn shared_webview(app: &AppHandle) -> Result<tauri::Webview, String> {
    app.get_webview("main")
        .ok_or_else(|| "main window not found".into())
}

/// Every cookie in the shared profile.
async fn all_cookies(app: &AppHandle) -> Result<Vec<SavedCookie>, String> {
    let webview = shared_webview(app)?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<SavedCookie>, String>>();
    webview
        .with_webview(move |platform| unsafe {
            let mut tx = Some(tx);
            let manager = match cookie_manager(&platform) {
                Ok(m) => m,
                Err(e) => {
                    if let Some(tx) = tx.take() {
                        let _ = tx.send(Err(e.to_string()));
                    }
                    return;
                }
            };
            let sender = std::sync::Arc::new(std::sync::Mutex::new(tx));
            let handler_sender = sender.clone();
            let handler = GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                let outcome = result.map_err(|e| e.to_string()).and_then(|_| {
                    let list = list.ok_or_else(|| "no cookie list".to_string())?;
                    let mut count = 0u32;
                    list.Count(&mut count).map_err(|e| e.to_string())?;
                    let mut cookies = Vec::with_capacity(count as usize);
                    for i in 0..count {
                        if let Ok(cookie) = list.GetValueAtIndex(i) {
                            cookies.push(to_saved(&cookie));
                        }
                    }
                    Ok(cookies)
                });
                if let Some(tx) = handler_sender.lock().ok().and_then(|mut g| g.take()) {
                    let _ = tx.send(outcome);
                }
                Ok(())
            }));
            if let Err(e) = manager.GetCookies(&HSTRING::new(), &handler) {
                if let Some(tx) = sender.lock().ok().and_then(|mut g| g.take()) {
                    let _ = tx.send(Err(e.to_string()));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|_| "cookie read was cancelled".to_string())?
}

/// Deletes `remove` and writes `add` in one pass on the WebView thread.
async fn rewrite_cookies(
    app: &AppHandle,
    remove: Vec<SavedCookie>,
    add: Vec<SavedCookie>,
) -> Result<(), String> {
    let webview = shared_webview(app)?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    webview
        .with_webview(move |platform| unsafe {
            let result = (|| -> windows_core::Result<()> {
                let manager = cookie_manager(&platform)?;
                for c in &remove {
                    let _ = manager.DeleteCookiesWithDomainAndPath(
                        &HSTRING::from(c.name.as_str()),
                        &HSTRING::from(c.domain.as_str()),
                        &HSTRING::from(c.path.as_str()),
                    );
                }
                for c in &add {
                    let cookie = manager.CreateCookie(
                        &HSTRING::from(c.name.as_str()),
                        &HSTRING::from(c.value.as_str()),
                        &HSTRING::from(c.domain.as_str()),
                        &HSTRING::from(c.path.as_str()),
                    )?;
                    if let Some(expires) = c.expires {
                        let _ = cookie.SetExpires(expires);
                    }
                    let _ = cookie.SetIsHttpOnly(c.http_only);
                    let _ = cookie.SetIsSecure(c.secure);
                    let _ = cookie.SetSameSite(COREWEBVIEW2_COOKIE_SAME_SITE_KIND(c.same_site));
                    let _ = manager.AddOrUpdateCookie(&cookie);
                }
                Ok(())
            })();
            let _ = tx.send(result.map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|_| "cookie write was cancelled".to_string())?
}

fn tile_host(app: &AppHandle, tile_id: &str) -> Result<String, String> {
    let label = format!("{}{tile_id}", crate::browser_tiles::TILE_WEBVIEW_PREFIX);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "website tile is not open".to_string())?;
    let url = webview.url().map_err(|e| e.to_string())?;
    url.host_str()
        .map(site_domain)
        .filter(|d| !d.is_empty())
        .ok_or_else(|| "this page has no site to save".into())
}

/// Reloads every website tile and site window showing `domain`.
fn reload_site(app: &AppHandle, domain: &str) {
    for (label, webview) in app.webviews() {
        if !(label.starts_with(crate::browser_tiles::TILE_WEBVIEW_PREFIX)
            || label.starts_with(crate::site_windows::SITE_WINDOW_PREFIX))
        {
            continue;
        }
        let matches = webview
            .url()
            .ok()
            .and_then(|u| u.host_str().map(site_domain))
            .map(|d| d == domain)
            .unwrap_or(false);
        if matches {
            let _ = webview.reload();
        }
    }
}

#[tauri::command]
pub async fn site_account_save(
    app: AppHandle,
    tile_id: String,
    name: String,
) -> Result<SiteAccountView, String> {
    let domain = tile_host(&app, &tile_id)?;
    let name: String = name.trim().chars().take(60).collect();
    if name.is_empty() {
        return Err("Give the sign-in a name".into());
    }
    let mut cookies: Vec<SavedCookie> = all_cookies(&app)
        .await?
        .into_iter()
        .filter(|c| cookie_belongs(&c.domain, &domain))
        .collect();
    if cookies.is_empty() {
        return Err(format!(
            "No cookies are stored for {domain} yet. Sign in first."
        ));
    }
    cookies.truncate(MAX_COOKIES_PER_PROFILE);
    let account = SiteAccount {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        domain,
        saved_at: chrono::Utc::now().timestamp_millis(),
        cookies,
    };
    let view = site_view(&account);
    let mut store = AccountStore::load();
    store.add_site(account)?;
    store.save()?;
    Ok(view)
}

#[tauri::command]
pub async fn site_account_switch(app: AppHandle, id: String) -> Result<(), String> {
    let store = AccountStore::load();
    let account = store
        .sites
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .ok_or_else(|| "That sign-in is no longer saved".to_string())?;
    let current: Vec<SavedCookie> = all_cookies(&app)
        .await?
        .into_iter()
        .filter(|c| cookie_belongs(&c.domain, &account.domain))
        .collect();
    rewrite_cookies(&app, current, account.cookies.clone()).await?;
    reload_site(&app, &account.domain);
    Ok(())
}

/// Clears the site's cookies (signs every tile on it out) and reloads them.
#[tauri::command]
pub async fn site_account_sign_out(app: AppHandle, tile_id: String) -> Result<String, String> {
    let domain = tile_host(&app, &tile_id)?;
    let current: Vec<SavedCookie> = all_cookies(&app)
        .await?
        .into_iter()
        .filter(|c| cookie_belongs(&c.domain, &domain))
        .collect();
    rewrite_cookies(&app, current, Vec::new()).await?;
    reload_site(&app, &domain);
    Ok(domain)
}

#[tauri::command]
pub async fn site_account_remove(id: String) -> Result<(), String> {
    let mut store = AccountStore::load();
    store.sites.retain(|s| s.id != id);
    store.save()
}

#[tauri::command]
pub async fn site_account_domain(app: AppHandle, tile_id: String) -> Result<String, String> {
    tile_host(&app, &tile_id)
}
