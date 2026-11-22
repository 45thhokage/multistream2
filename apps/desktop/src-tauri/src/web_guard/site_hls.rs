//! Experimental direct HLS playback for website tiles (live-room sites).
//!
//! `core/site_hls.js` runs in the page and finds the room's playlist (an
//! observed request first, then per-site room APIs). Playback happens in an
//! overlay inside the same page, so requests keep the site's own origin,
//! cookies and CORS rules: nothing is proxied or bypassed.

use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

use super::GuardState;

pub const SITE_HLS_SCRIPT: &str = include_str!("../core/site_hls.js");
const HLS_BUNDLE: &str = include_str!("../core/vendor/hls.light.min.js");

/// hls.js wrapped so it never registers with a page's AMD/CommonJS loader and
/// never replaces a `window.Hls` the site itself uses.
fn hls_loader() -> &'static str {
    static LOADER: OnceLock<String> = OnceLock::new();
    LOADER.get_or_init(|| {
        format!(
            "(function(){{if(window.__msHls)return;var __prev=window.Hls;var define,module,exports;\
             try{{{HLS_BUNDLE}\n}}catch(e){{}}window.__msHls=window.Hls;\
             if(__prev!==undefined){{window.Hls=__prev}}else{{try{{delete window.Hls}}catch(e){{window.Hls=undefined}}}}}})();"
        )
    })
}

fn eval(app: &AppHandle, label: &str, js: &str) {
    if let Some(webview) = app.get_webview(label) {
        let _ = webview.eval(js);
    }
}

/// Turns direct playback on or off in the page currently shown by `label`.
pub fn apply(app: &AppHandle, label: &str, enabled: bool) {
    if !enabled {
        eval(
            app,
            label,
            "window.__msSiteHls&&window.__msSiteHls.disable()",
        );
        return;
    }
    let sniffed: Vec<String> = app
        .state::<GuardState>()
        .diag
        .lock()
        .map(|diag| {
            diag.media_for(label)
                .into_iter()
                .filter(|m| m.kind == "hls")
                .map(|m| m.url)
                .collect()
        })
        .unwrap_or_default();
    let sniffed = serde_json::to_string(&sniffed).unwrap_or_else(|_| "[]".into());
    eval(app, label, hls_loader());
    eval(
        app,
        label,
        &format!("window.__msSiteHls&&window.__msSiteHls.enable({{sniffed:{sniffed}}})"),
    );
}

/// Passes a newly observed playlist to a page that is still looking for one.
pub fn offer(app: &AppHandle, label: &str, url: &str) {
    let value = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".into());
    eval(
        app,
        label,
        &format!("window.__msSiteHls&&window.__msSiteHls.offer({value})"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_shadows_module_systems_and_restores_global() {
        // Arrange / Act
        let loader = hls_loader();
        // Assert
        assert!(loader.starts_with("(function(){if(window.__msHls)return;"));
        assert!(loader.contains("var define,module,exports;"));
        assert!(loader.contains("window.__msHls=window.Hls;"));
        assert!(loader.ends_with("})();"));
    }
}
