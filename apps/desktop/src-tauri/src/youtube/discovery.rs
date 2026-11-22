use super::api::{get_youtube_client, get_youtube_semaphore};
use super::parser::{
    extract_live_streams_from_initial_data, extract_yt_initial_data, get_text_from_node,
    parse_viewer_count,
};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize)]
pub struct LiveSearchPage {
    items: Vec<Value>,
    cursor: Option<String>,
}

fn continuation(data: &Value) -> Option<String> {
    if let Some(token) = data
        .pointer("/continuationItemRenderer/continuationEndpoint/continuationCommand/token")
        .and_then(Value::as_str)
    {
        return Some(token.to_owned());
    }
    match data {
        Value::Object(map) => map.values().find_map(continuation),
        Value::Array(items) => items.iter().find_map(continuation),
        _ => None,
    }
}

fn channel_id(data: &Value, video: &str) -> Option<String> {
    if data.get("videoId").and_then(Value::as_str) == Some(video) {
        for key in ["ownerText", "shortBylineText"] {
            if let Some(id) = data
                .pointer(&format!(
                    "/{key}/runs/0/navigationEndpoint/browseEndpoint/browseId"
                ))
                .and_then(Value::as_str)
            {
                return Some(id.to_owned());
            }
        }
    }
    match data {
        Value::Object(map) => map.values().find_map(|v| channel_id(v, video)),
        Value::Array(items) => items.iter().find_map(|v| channel_id(v, video)),
        _ => None,
    }
}

fn renderer_viewers(data: &Value, video: &str) -> Option<u64> {
    if data.get("videoId").and_then(Value::as_str) == Some(video) {
        return get_text_from_node(data.get("viewCountText"))
            .filter(|text| text.to_lowercase().contains("watching"))
            .map(|text| parse_viewer_count(&text));
    }
    match data {
        Value::Object(map) => map.values().find_map(|v| renderer_viewers(v, video)),
        Value::Array(items) => items.iter().find_map(|v| renderer_viewers(v, video)),
        _ => None,
    }
}

fn parse_page(data: &Value) -> LiveSearchPage {
    let items = extract_live_streams_from_initial_data(data, 100).into_iter().filter_map(|stream| {
        let handle = stream.handle.clone().or_else(|| channel_id(data, &stream.channel))?;
        let mut item = json!({
            "channel": stream.channel, "platform": "youtube", "handle": handle,
            "displayName": stream.display_name, "title": stream.title, "category": "",
            "viewerCount": if stream.viewer_count > 0 { Some(stream.viewer_count) } else { renderer_viewers(data, &stream.channel) },
            "thumbnail": stream.thumbnail, "status": "live"
        });
        if let Some(fields) = item.as_object_mut() { fields.retain(|_, value| !value.is_null()); }
        Some(item)
    }).collect();
    LiveSearchPage {
        items,
        cursor: continuation(data),
    }
}

#[tauri::command]
pub async fn youtube_search_live(
    query: String,
    cursor: Option<String>,
) -> Result<LiveSearchPage, String> {
    let _permit = get_youtube_semaphore()
        .acquire()
        .await
        .map_err(|e| e.to_string())?;
    let client = get_youtube_client();
    let request = if let Some(token) = cursor {
        client.post("https://www.youtube.com/youtubei/v1/search?prettyPrint=false")
            .json(&json!({"context": {"client": {"clientName": "WEB", "clientVersion": "2.20240903.01.00", "hl": "en", "gl": "US"}}, "continuation": token}))
    } else {
        client.get("https://www.youtube.com/results").query(&[
            ("search_query", query.as_str()),
            ("sp", "EgJAAQ=="),
            ("hl", "en"),
            ("gl", "US"),
        ])
    };
    let response = request
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Cookie", "SOCS=CAI; CONSENT=YES+cb; PREF=hl=en&gl=US")
        .send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?;
    let text = response.text().await.map_err(|e| e.to_string())?;
    let data = serde_json::from_str::<Value>(&text)
        .ok()
        .or_else(|| extract_yt_initial_data(&text))
        .ok_or_else(|| "YouTube did not return search data".to_string())?;
    if data.get("error").is_some() {
        return Err("YouTube search failed".into());
    }
    Ok(parse_page(&data))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_distinct_live_broadcasts_and_continuation() {
        // Arrange
        let card = |id: &str| json!({"videoRenderer": {"videoId": id, "viewCountText": {"simpleText": "0 watching"}, "title": {"simpleText": "Live"}, "badges": [{"metadataBadgeRenderer": {"style": "BADGE_STYLE_TYPE_LIVE_NOW"}}], "ownerText": {"runs": [{"text": "Channel", "navigationEndpoint": {"browseEndpoint": {"browseId": "UCexample"}}}]}}});
        let data = json!([card("abcdefghijk"), card("lmnopqrstuv"), {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "next"}}}}, {"videoRenderer": {"videoId": "upcoming123", "upcomingEventData": {}}}]);
        // Act
        let page = parse_page(&data);
        // Assert
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0]["viewerCount"], 0);
        assert_eq!(page.items[0]["handle"], "UCexample");
        assert_eq!(page.cursor.as_deref(), Some("next"));
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires public YouTube access"]
    async fn public_live_search_continues() {
        // Arrange
        let query = "lofi".to_string();
        // Act
        let first = youtube_search_live(query.clone(), None)
            .await
            .expect("first search page");
        let cursor = first.cursor.clone().expect("search continuation");
        let second = youtube_search_live(query, Some(cursor))
            .await
            .expect("second search page");
        // Assert
        assert!(!first.items.is_empty());
        assert!(!second.items.is_empty());
        assert!(second.items.iter().any(|item| !first
            .items
            .iter()
            .any(|old| old["channel"] == item["channel"])));
        println!(
            "YouTube public live search: {} first-page and {} continuation broadcasts",
            first.items.len(),
            second.items.len()
        );
    }
}
