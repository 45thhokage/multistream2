//! Saved-account store (`<config>/multistream/accounts.bin`).

use serde::{Deserialize, Serialize};

use crate::kick::state::KickAuthInfo;
use crate::twitch::state::TwitchAuthInfo;

const MAX_ACCOUNTS_PER_PLATFORM: usize = 20;
const MAX_SITE_ACCOUNTS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    /// Seconds since the epoch; `None` for session cookies.
    pub expires: Option<f64>,
    pub http_only: bool,
    pub secure: bool,
    /// 0 = None, 1 = Lax, 2 = Strict (WebView2's COREWEBVIEW2_COOKIE_SAME_SITE_KIND).
    pub same_site: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteAccount {
    pub id: String,
    pub name: String,
    pub domain: String,
    pub saved_at: i64,
    pub cookies: Vec<SavedCookie>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStore {
    #[serde(default)]
    pub twitch: Vec<TwitchAuthInfo>,
    #[serde(default)]
    pub kick: Vec<KickAuthInfo>,
    #[serde(default)]
    pub sites: Vec<SiteAccount>,
}

fn store_path() -> std::path::PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    path.push("multistream");
    let _ = std::fs::create_dir_all(&path);
    #[cfg(debug_assertions)]
    path.push("accounts_dev.bin");
    #[cfg(not(debug_assertions))]
    path.push("accounts.bin");
    path
}

impl AccountStore {
    pub fn load() -> Self {
        std::fs::read(store_path())
            .ok()
            .and_then(|bytes| protect::unprotect(&bytes))
            .and_then(|plain| serde_json::from_slice(&plain).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), String> {
        let json = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        let sealed = protect::protect(&json)?;
        let path = store_path();
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, sealed).map_err(|e| format!("failed to write accounts: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::rename(&tmp, &path).map_err(|e| format!("failed to save accounts: {e}"))
    }

    pub fn upsert_twitch(&mut self, auth: TwitchAuthInfo) {
        self.twitch.retain(|a| {
            a.user_id != auth.user_id && !a.username.eq_ignore_ascii_case(&auth.username)
        });
        self.twitch.insert(0, auth);
        self.twitch.truncate(MAX_ACCOUNTS_PER_PLATFORM);
    }

    pub fn upsert_kick(&mut self, auth: KickAuthInfo) {
        self.kick
            .retain(|a| !a.username.eq_ignore_ascii_case(&auth.username));
        self.kick.insert(0, auth);
        self.kick.truncate(MAX_ACCOUNTS_PER_PLATFORM);
    }

    pub fn add_site(&mut self, account: SiteAccount) -> Result<(), String> {
        if self.sites.len() >= MAX_SITE_ACCOUNTS {
            return Err(format!("At most {MAX_SITE_ACCOUNTS} saved site sign-ins"));
        }
        self.sites
            .retain(|s| !(s.domain == account.domain && s.name == account.name));
        self.sites.push(account);
        Ok(())
    }
}

/// Registrable-domain approximation: `www.sub.example.co.uk` → `example.co.uk`.
pub fn site_domain(host: &str) -> String {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').filter(|l| !l.is_empty()).collect();
    if labels.len() <= 2 {
        return labels.join(".");
    }
    let last = labels[labels.len() - 1];
    let second = labels[labels.len() - 2];
    let take = if last.len() == 2
        && matches!(
            second,
            "co" | "com" | "net" | "org" | "gov" | "ac" | "edu" | "ne" | "or"
        ) {
        3
    } else {
        2
    };
    labels[labels.len() - take..].join(".")
}

/// Whether a cookie's domain belongs to `site` (the cookie applies to it or a subdomain).
pub fn cookie_belongs(cookie_domain: &str, site: &str) -> bool {
    let domain = cookie_domain.trim_start_matches('.').to_ascii_lowercase();
    domain == site || domain.ends_with(&format!(".{site}"))
}

mod protect {
    #[cfg(windows)]
    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: plain.len() as u32,
                pbData: plain.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let ok = CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                &mut output,
            );
            if ok == 0 {
                return Err("could not encrypt the account store".into());
            }
            let sealed = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            windows_sys::Win32::Foundation::LocalFree(output.pbData as _);
            Ok(sealed)
        }
    }

    #[cfg(windows)]
    pub fn unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
        use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: sealed.len() as u32,
                pbData: sealed.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let ok = CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                &mut output,
            );
            if ok == 0 {
                return None;
            }
            let plain = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            windows_sys::Win32::Foundation::LocalFree(output.pbData as _);
            Some(plain)
        }
    }

    // Other platforms keep the same 0600 JSON the existing Twitch/Kick auth files use.
    #[cfg(not(windows))]
    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        Ok(plain.to_vec())
    }

    #[cfg(not(windows))]
    pub fn unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
        Some(sealed.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_registrable_domains() {
        // Arrange / Act / Assert
        assert_eq!(site_domain("www.chaturbate.com"), "chaturbate.com");
        assert_eq!(site_domain("a.b.example.co.uk"), "example.co.uk");
        assert_eq!(site_domain("example.com"), "example.com");
    }

    #[test]
    fn cookies_match_site_and_subdomains_only() {
        // Arrange / Act / Assert
        assert!(cookie_belongs(".example.com", "example.com"));
        assert!(cookie_belongs("www.example.com", "example.com"));
        assert!(!cookie_belongs("notexample.com", "example.com"));
    }

    #[test]
    fn upsert_replaces_same_account_and_keeps_newest_first() {
        // Arrange
        let mut store = AccountStore::default();
        let auth = |name: &str, token: &str| TwitchAuthInfo {
            access_token: token.into(),
            refresh_token: "r".into(),
            username: name.into(),
            user_id: format!("id-{name}"),
        };
        // Act
        store.upsert_twitch(auth("alice", "1"));
        store.upsert_twitch(auth("bob", "2"));
        store.upsert_twitch(auth("alice", "3"));
        // Assert
        assert_eq!(store.twitch.len(), 2);
        assert_eq!(store.twitch[0].username, "alice");
        assert_eq!(store.twitch[0].access_token, "3");
    }

    #[test]
    fn protection_round_trips() {
        // Arrange
        let plain = b"{\"twitch\":[]}";
        // Act
        let sealed = protect::protect(plain).unwrap();
        let back = protect::unprotect(&sealed).unwrap();
        // Assert
        assert_eq!(back, plain);
    }
}
