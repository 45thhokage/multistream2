use std::path::Path;

pub fn is_recording_supported() -> bool {
    cfg!(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        target_os = "macos"
    ))
}

pub fn build_stream_url(platform: &str, channel: &str) -> String {
    match platform {
        "twitch" => format!("https://twitch.tv/{channel}"),
        "kick" => format!("https://kick.com/{channel}"),
        "youtube" => format!("https://youtube.com/watch?v={channel}"),
        _ => unreachable!("platform must be validated before calling build_stream_url"),
    }
}

const DIRECT_FILE_EXTENSIONS: &[&str] = &[
    ".mp4", ".m4v", ".webm", ".mkv", ".mov", ".ts", ".flv", ".mp3", ".aac", ".m4a", ".ogg", ".ogv",
];

/// Streamlink protocol prefix for a URL that is itself a stream, if it is one.
pub fn direct_stream_target(url: &str) -> Option<String> {
    let parsed = url.parse::<tauri::Url>().ok()?;
    let path = parsed.path().to_ascii_lowercase();
    if path.ends_with(".m3u8") || path.ends_with(".m3u") {
        Some(format!("hls://{url}"))
    } else if path.ends_with(".mpd") {
        Some(format!("dash://{url}"))
    } else if DIRECT_FILE_EXTENSIONS.iter().any(|ext| path.ends_with(ext)) {
        Some(format!("httpstream://{url}"))
    } else {
        None
    }
}

/// `platform_channel` label for a URL recording: host plus last path segment.
pub fn url_label(url: &str) -> String {
    let parsed = url.parse::<tauri::Url>().ok();
    let host = parsed
        .as_ref()
        .and_then(|u| u.host_str())
        .unwrap_or("site")
        .trim_start_matches("www.")
        .to_string();
    let segment = parsed
        .as_ref()
        .and_then(|u| u.path_segments())
        .and_then(|mut s| s.rfind(|p| !p.is_empty()).map(str::to_string))
        .unwrap_or_default();
    let raw = if segment.is_empty() {
        host
    } else {
        format!("{host}-{segment}")
    };
    let clean: String = raw
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    if clean.is_empty() {
        "stream".to_string()
    } else {
        clean
    }
}

/// Extra request headers so CDNs that check where a playlist was opened from accept Streamlink.
pub fn streamlink_header_args(referer: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "--http-header".to_string(),
        format!("User-Agent={}", crate::USER_AGENT),
    ];
    if let Some(referer) = referer.filter(|r| r.starts_with("http")) {
        args.push("--http-header".to_string());
        args.push(format!("Referer={referer}"));
        if let Ok(url) = referer.parse::<tauri::Url>() {
            args.push("--http-header".to_string());
            args.push(format!("Origin={}", url.origin().ascii_serialization()));
        }
    }
    args
}

/// Builds the full argument list to pass to the Streamlink executable.
///
/// On Windows and macOS, the executable is `python3`/`python.exe` so we prefix
/// with `-m streamlink`. On Linux the executable is the AppImage `AppRun` which
/// IS the streamlink CLI, so no prefix is needed.
pub fn streamlink_args(url: &str, quality: &str, output: &Path) -> Vec<String> {
    let resolved_quality = match quality {
        "1080p" => "1080p60,1080p,1080p50,best",
        "720p" => "720p60,720p,720p50,best",
        "480p" => "480p,worst",
        "audio_only" => "audio_only,audio",
        _ => quality, // "best", "worst", etc.
    };

    #[cfg(target_os = "linux")]
    let prefix: &[&str] = &[];
    #[cfg(not(target_os = "linux"))]
    let prefix: &[&str] = &["-m", "streamlink"];

    let mut args: Vec<String> = prefix.iter().map(|s| s.to_string()).collect();
    args.extend([
        url.to_string(),
        resolved_quality.to_string(),
        "--output".to_string(),
        output.to_string_lossy().to_string(),
        "--force".to_string(),
        "--retry-streams".to_string(),
        "5".to_string(),
        "--retry-open".to_string(),
        "5".to_string(),
    ]);
    args
}

pub fn ffmpeg_remux_args(input: &Path, output: &Path) -> Vec<String> {
    vec![
        "-y".to_string(), // put -y at the beginning
        "-i".to_string(),
        input.to_string_lossy().to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
        output.to_string_lossy().to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn should_build_correct_stream_url() {
        assert_eq!(
            build_stream_url("twitch", "gaules"),
            "https://twitch.tv/gaules"
        );
        assert_eq!(build_stream_url("kick", "xqc"), "https://kick.com/xqc");
        assert_eq!(
            build_stream_url("youtube", "lofigirl"),
            "https://youtube.com/watch?v=lofigirl"
        );
    }

    #[test]
    fn should_build_streamlink_args_with_resolved_quality() {
        let path = PathBuf::from("output.ts");

        let args = streamlink_args("https://twitch.tv/test", "1080p", &path);

        // On non-Linux platforms the first two args are the python module prefix.
        // On Linux the AppRun IS the CLI so args start directly with the URL.
        #[cfg(not(target_os = "linux"))]
        {
            assert_eq!(args[0], "-m");
            assert_eq!(args[1], "streamlink");
            assert_eq!(args[2], "https://twitch.tv/test");
            assert_eq!(args[3], "1080p60,1080p,1080p50,best");
            assert_eq!(args[4], "--output");
            assert_eq!(args[5], "output.ts");
        }
        #[cfg(target_os = "linux")]
        {
            assert_eq!(args[0], "https://twitch.tv/test");
            assert_eq!(args[1], "1080p60,1080p,1080p50,best");
            assert_eq!(args[2], "--output");
            assert_eq!(args[3], "output.ts");
        }

        assert!(args.contains(&"--force".to_string()));
    }

    #[test]
    fn should_prefix_direct_stream_urls_for_streamlink() {
        assert_eq!(
            direct_stream_target("https://cdn.example/live/master.m3u8?t=1").as_deref(),
            Some("hls://https://cdn.example/live/master.m3u8?t=1")
        );
        assert_eq!(
            direct_stream_target("https://cdn.example/v/manifest.mpd").as_deref(),
            Some("dash://https://cdn.example/v/manifest.mpd")
        );
        assert_eq!(
            direct_stream_target("https://cdn.example/clip.mp4").as_deref(),
            Some("httpstream://https://cdn.example/clip.mp4")
        );
        assert_eq!(direct_stream_target("https://site.example/room"), None);
    }

    #[test]
    fn should_derive_safe_labels_from_urls() {
        assert_eq!(
            url_label("https://www.site.example/room_1/"),
            "site.example-room_1"
        );
        assert_eq!(url_label("https://site.example/"), "site.example");
        assert!(url_label("https://site.example/a%20b?x=1")
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.')));
    }

    #[test]
    fn should_add_referer_and_origin_headers() {
        let args = streamlink_header_args(Some("https://site.example/room"));
        assert!(args.contains(&"Referer=https://site.example/room".to_string()));
        assert!(args.contains(&"Origin=https://site.example".to_string()));
        assert_eq!(streamlink_header_args(None).len(), 2);
    }

    #[test]
    fn should_build_ffmpeg_remux_args() {
        let input = PathBuf::from("in.ts");
        let output = PathBuf::from("out.mp4");

        let args = ffmpeg_remux_args(&input, &output);

        assert_eq!(args[0], "-y");
        assert_eq!(args[1], "-i");
        assert_eq!(args[2], "in.ts");
        assert_eq!(args[3], "-c");
        assert_eq!(args[4], "copy");
        assert_eq!(args[5], "-movflags");
        assert_eq!(args[6], "+faststart");

        // Output must be the last argument
        assert_eq!(args.last().unwrap(), "out.mp4");
    }
}
