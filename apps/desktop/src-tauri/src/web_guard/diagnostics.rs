//! Bounded in-memory diagnostics: blocked requests, detected media and
//! site-HLS state. Nothing is written to disk unless the user exports it.

use std::collections::{HashMap, VecDeque};

use serde::Serialize;

const MAX_BLOCKED_EVENTS: usize = 400;
const MAX_MEDIA_PER_TILE: usize = 12;
const MAX_URL_CHARS: usize = 400;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedEvent {
    pub time: i64,
    pub webview: String,
    pub url: String,
    pub host: String,
    pub page_host: String,
    pub request_type: String,
    pub rule: Option<String>,
    pub list: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedMedia {
    pub url: String,
    pub kind: String,
    pub page_url: String,
    pub detected_at: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SiteHlsStatus {
    pub enabled: bool,
    pub state: String,
    pub source: Option<String>,
    pub url: Option<String>,
    pub level: Option<String>,
    pub message: Option<String>,
    pub updated_at: i64,
}

#[derive(Default)]
pub struct Diagnostics {
    pub blocked: VecDeque<BlockedEvent>,
    pub blocked_total: u64,
    pub blocked_by_webview: HashMap<String, u64>,
    pub blocked_by_list: HashMap<String, u64>,
    pub media: HashMap<String, VecDeque<DetectedMedia>>,
    pub site_hls: HashMap<String, SiteHlsStatus>,
    pub engine_built_at: Option<i64>,
    pub engine_build_ms: Option<u64>,
    pub engine_rules: usize,
    pub engine_error: Option<String>,
    pub last_update_check: Option<i64>,
}

pub fn clip(url: &str) -> String {
    if url.chars().count() <= MAX_URL_CHARS {
        url.to_string()
    } else {
        let mut out: String = url.chars().take(MAX_URL_CHARS).collect();
        out.push('…');
        out
    }
}

impl Diagnostics {
    pub fn record_blocked(&mut self, event: BlockedEvent) {
        self.blocked_total += 1;
        *self
            .blocked_by_webview
            .entry(event.webview.clone())
            .or_default() += 1;
        if let Some(list) = &event.list {
            *self.blocked_by_list.entry(list.clone()).or_default() += 1;
        }
        if self.blocked.len() >= MAX_BLOCKED_EVENTS {
            self.blocked.pop_front();
        }
        self.blocked.push_back(event);
    }

    /// Returns true when the media URL was not already known for this webview.
    pub fn record_media(&mut self, webview: &str, media: DetectedMedia) -> bool {
        let list = self.media.entry(webview.to_string()).or_default();
        if let Some(pos) = list.iter().position(|m| m.url == media.url) {
            let existing = list.remove(pos).expect("position is valid");
            list.push_back(DetectedMedia {
                detected_at: media.detected_at,
                ..existing
            });
            return false;
        }
        if list.len() >= MAX_MEDIA_PER_TILE {
            list.pop_front();
        }
        list.push_back(media);
        true
    }

    pub fn clear_media(&mut self, webview: &str) {
        self.media.remove(webview);
    }

    /// Most recent playlists first, masters before media playlists.
    pub fn media_for(&self, webview: &str) -> Vec<DetectedMedia> {
        let mut items: Vec<DetectedMedia> = self
            .media
            .get(webview)
            .map(|list| list.iter().rev().cloned().collect())
            .unwrap_or_default();
        items.sort_by_key(|m| {
            let lower = m.url.to_ascii_lowercase();
            if lower.contains("master") || lower.contains("playlist") || lower.contains("_auto") {
                0
            } else {
                1
            }
        });
        items
    }

    pub fn forget_webview(&mut self, webview: &str) {
        self.media.remove(webview);
        self.site_hls.remove(webview);
        self.blocked_by_webview.remove(webview);
    }

    pub fn clear(&mut self) {
        self.blocked.clear();
        self.blocked_total = 0;
        self.blocked_by_webview.clear();
        self.blocked_by_list.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media(url: &str, at: i64) -> DetectedMedia {
        DetectedMedia {
            url: url.into(),
            kind: "hls".into(),
            page_url: "https://site.example/room".into(),
            detected_at: at,
        }
    }

    #[test]
    fn blocked_events_are_bounded_and_counted() {
        // Arrange
        let mut diag = Diagnostics::default();
        // Act
        for i in 0..(MAX_BLOCKED_EVENTS + 5) {
            diag.record_blocked(BlockedEvent {
                time: i as i64,
                webview: "tile-a".into(),
                url: format!("https://ads.example/{i}"),
                host: "ads.example".into(),
                page_host: "news.example".into(),
                request_type: "script".into(),
                rule: None,
                list: Some("EasyList".into()),
            });
        }
        // Assert
        assert_eq!(diag.blocked.len(), MAX_BLOCKED_EVENTS);
        assert_eq!(diag.blocked_total, (MAX_BLOCKED_EVENTS + 5) as u64);
        assert_eq!(
            diag.blocked_by_list["EasyList"],
            (MAX_BLOCKED_EVENTS + 5) as u64
        );
    }

    #[test]
    fn media_is_deduplicated_and_masters_sort_first() {
        // Arrange
        let mut diag = Diagnostics::default();
        // Act
        let first = diag.record_media("tile-a", media("https://cdn.example/chunk_720.m3u8", 1));
        let master = diag.record_media("tile-a", media("https://cdn.example/master.m3u8", 2));
        let again = diag.record_media("tile-a", media("https://cdn.example/chunk_720.m3u8", 3));
        let list = diag.media_for("tile-a");
        // Assert
        assert!(first && master && !again);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].url, "https://cdn.example/master.m3u8");
    }

    #[test]
    fn clips_long_urls() {
        // Arrange
        let long = format!("https://x.example/{}", "a".repeat(1000));
        // Act
        let clipped = clip(&long);
        // Assert
        assert!(clipped.chars().count() <= MAX_URL_CHARS + 1);
        assert!(clipped.ends_with('…'));
    }
}
