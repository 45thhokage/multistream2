//! Multiple saved accounts.
//!
//! * Twitch and Kick: every account you sign in with can be kept, and switching
//!   makes a saved one the active sign-in (chat reconnects with it). Signing out
//!   stays local, so a saved account's tokens remain usable.
//! * Websites (Windows): a site's cookies can be saved as a named profile and
//!   written back later, which switches the sign-in for every tile on that site.
//!
//! The store is encrypted with Windows DPAPI (current user) where available.

#[cfg(windows)]
pub mod site_cookies;
pub mod store;

/// Site sign-in profiles need WebView2's cookie manager.
#[cfg(not(windows))]
pub mod site_cookies {
    use super::SiteAccountView;
    const UNSUPPORTED: &str = "Saved site sign-ins need the Windows desktop build";

    #[tauri::command]
    pub async fn site_account_save(
        _tile_id: String,
        _name: String,
    ) -> Result<SiteAccountView, String> {
        Err(UNSUPPORTED.into())
    }
    #[tauri::command]
    pub async fn site_account_switch(_id: String) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    #[tauri::command]
    pub async fn site_account_sign_out(_tile_id: String) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }
    #[tauri::command]
    pub async fn site_account_remove(id: String) -> Result<(), String> {
        let mut store = super::store::AccountStore::load();
        store.sites.retain(|s| s.id != id);
        store.save()
    }
    #[tauri::command]
    pub async fn site_account_domain(_tile_id: String) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }
}

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::kick::state::{KickAuthState, KickState};
use crate::twitch::state::{AuthState, TwitchState};
use store::{AccountStore, SiteAccount};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAccountView {
    pub username: String,
    pub active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteAccountView {
    pub id: String,
    pub name: String,
    pub domain: String,
    pub saved_at: i64,
    pub cookie_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsView {
    pub twitch: Vec<PlatformAccountView>,
    pub kick: Vec<PlatformAccountView>,
    pub sites: Vec<SiteAccountView>,
    pub site_profiles_supported: bool,
}

fn platform_views(saved: Vec<String>, active: Option<String>) -> Vec<PlatformAccountView> {
    let mut names = saved;
    if let Some(active) = &active {
        if !names.iter().any(|n| n.eq_ignore_ascii_case(active)) {
            names.insert(0, active.clone());
        }
    }
    names
        .into_iter()
        .map(|username| PlatformAccountView {
            active: active
                .as_deref()
                .map(|a| a.eq_ignore_ascii_case(&username))
                .unwrap_or(false),
            username,
        })
        .collect()
}

pub fn site_view(account: &SiteAccount) -> SiteAccountView {
    SiteAccountView {
        id: account.id.clone(),
        name: account.name.clone(),
        domain: account.domain.clone(),
        saved_at: account.saved_at,
        cookie_count: account.cookies.len(),
    }
}

/// Keeps whoever is signed in now in the saved list (tokens refreshed in place).
async fn remember_active(app: &AppHandle) -> Result<(), String> {
    let twitch = app.state::<TwitchState>().auth.lock().await.clone();
    let kick = app.state::<KickState>().auth.lock().await.clone();
    if twitch.is_none() && kick.is_none() {
        return Ok(());
    }
    let mut store = AccountStore::load();
    if let Some(auth) = twitch {
        store.upsert_twitch(auth);
    }
    if let Some(auth) = kick {
        store.upsert_kick(auth);
    }
    store.save()
}

#[tauri::command]
pub async fn accounts_list(
    app: AppHandle,
    twitch: State<'_, TwitchState>,
    kick: State<'_, KickState>,
) -> Result<AccountsView, String> {
    remember_active(&app).await?;
    let store = AccountStore::load();
    let twitch_active = twitch
        .auth
        .lock()
        .await
        .as_ref()
        .map(|a| a.username.clone());
    let kick_active = kick.auth.lock().await.as_ref().map(|a| a.username.clone());
    Ok(AccountsView {
        twitch: platform_views(
            store.twitch.iter().map(|a| a.username.clone()).collect(),
            twitch_active,
        ),
        kick: platform_views(
            store.kick.iter().map(|a| a.username.clone()).collect(),
            kick_active,
        ),
        sites: store.sites.iter().map(site_view).collect(),
        site_profiles_supported: cfg!(windows),
    })
}

#[tauri::command]
pub async fn accounts_switch(
    app: AppHandle,
    platform: String,
    username: String,
) -> Result<(), String> {
    remember_active(&app).await?;
    let store = AccountStore::load();
    match platform.as_str() {
        "twitch" => {
            let auth = store
                .twitch
                .iter()
                .find(|a| a.username.eq_ignore_ascii_case(&username))
                .cloned()
                .ok_or_else(|| "That Twitch account is not saved".to_string())?;
            let state = app.state::<TwitchState>();
            crate::twitch::oauth::store_auth(&app, &auth).map_err(|e| e.to_string())?;
            *state.auth.lock().await = Some(auth.clone());
            let _ = app.emit(
                "twitch-auth-changed",
                AuthState {
                    authenticated: true,
                    username: Some(auth.username.clone()),
                },
            );
            // Reconnect chat as the new account and refresh its token if needed.
            let channels = state.subscriptions.lock().await.grid_channels.clone();
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(http) = reqwest::Client::builder().use_rustls_tls().build() {
                    let state = app_clone.state::<TwitchState>();
                    if let Ok(refreshed) = crate::twitch::commands::try_refresh_if_needed(
                        &app_clone, auth, &state, &http,
                    )
                    .await
                    {
                        let mut store = AccountStore::load();
                        store.upsert_twitch(refreshed);
                        let _ = store.save();
                    }
                }
                crate::twitch::irc::update_subscriptions(&app_clone, channels).await;
            });
            Ok(())
        }
        "kick" => {
            let auth = store
                .kick
                .iter()
                .find(|a| a.username.eq_ignore_ascii_case(&username))
                .cloned()
                .ok_or_else(|| "That Kick account is not saved".to_string())?;
            crate::kick::oauth::store_auth(&auth).map_err(|e| e.to_string())?;
            *app.state::<KickState>().auth.lock().await = Some(auth.clone());
            let _ = app.emit(
                "kick-auth-changed",
                KickAuthState {
                    authenticated: true,
                    username: Some(auth.username.clone()),
                },
            );
            Ok(())
        }
        _ => Err("Unknown platform".into()),
    }
}

#[tauri::command]
pub async fn accounts_remove(
    app: AppHandle,
    platform: String,
    username: String,
) -> Result<(), String> {
    let mut store = AccountStore::load();
    match platform.as_str() {
        "twitch" => {
            let active = app
                .state::<TwitchState>()
                .auth
                .lock()
                .await
                .as_ref()
                .map(|a| a.username.clone());
            if active
                .as_deref()
                .map(|a| a.eq_ignore_ascii_case(&username))
                .unwrap_or(false)
            {
                return Err("Sign out of the active account before removing it".into());
            }
            store
                .twitch
                .retain(|a| !a.username.eq_ignore_ascii_case(&username));
        }
        "kick" => {
            let active = app
                .state::<KickState>()
                .auth
                .lock()
                .await
                .as_ref()
                .map(|a| a.username.clone());
            if active
                .as_deref()
                .map(|a| a.eq_ignore_ascii_case(&username))
                .unwrap_or(false)
            {
                return Err("Sign out of the active account before removing it".into());
            }
            store
                .kick
                .retain(|a| !a.username.eq_ignore_ascii_case(&username));
        }
        _ => return Err("Unknown platform".into()),
    }
    store.save()
}

/// Keeps the current account saved, then signs out locally so another can be added.
#[tauri::command]
pub async fn accounts_prepare_add(app: AppHandle, platform: String) -> Result<(), String> {
    remember_active(&app).await?;
    match platform.as_str() {
        "twitch" => {
            let state = app.state::<TwitchState>();
            if let Some(tx) = state.irc_shutdown_tx.lock().await.take() {
                let _ = tx.send(());
            }
            *state.auth.lock().await = None;
            crate::twitch::oauth::clear_auth(&app);
            let _ = app.emit(
                "twitch-auth-changed",
                AuthState {
                    authenticated: false,
                    username: None,
                },
            );
        }
        "kick" => {
            *app.state::<KickState>().auth.lock().await = None;
            crate::kick::oauth::clear_auth();
            let _ = app.emit(
                "kick-auth-changed",
                KickAuthState {
                    authenticated: false,
                    username: None,
                },
            );
        }
        _ => return Err("Unknown platform".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_account_is_listed_and_marked_even_when_unsaved() {
        // Arrange
        let saved = vec!["alice".to_string(), "bob".to_string()];
        // Act
        let views = platform_views(saved, Some("carol".into()));
        // Assert
        assert_eq!(views.len(), 3);
        assert_eq!(views[0].username, "carol");
        assert!(views[0].active);
        assert!(!views[1].active && !views[2].active);
    }

    #[test]
    fn active_match_ignores_case() {
        // Arrange / Act
        let views = platform_views(vec!["Alice".into()], Some("alice".into()));
        // Assert
        assert_eq!(views.len(), 1);
        assert!(views[0].active);
    }
}
