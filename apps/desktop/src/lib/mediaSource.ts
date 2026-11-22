import { isTauri } from "./http";

/** Streams the app plays itself instead of loading a web page. */
export type MediaKind = "hls" | "dash" | "file";

const FILE_EXTENSIONS = [
  ".mp4",
  ".m4v",
  ".webm",
  ".mov",
  ".mkv",
  ".ogv",
  ".ogg",
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".flac",
];

function parse(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** HLS (`.m3u8`), DASH (`.mpd`) or a direct media file, judged by the URL path. */
export function mediaKindOf(raw: string): MediaKind | null {
  const url = parse(raw);
  if (!url) return null;
  const path = url.pathname.toLowerCase();
  if (path.endsWith(".m3u8") || path.endsWith(".m3u")) return "hls";
  if (path.endsWith(".mpd")) return "dash";
  if (FILE_EXTENSIONS.some((ext) => path.endsWith(ext))) return "file";
  return null;
}

/** Short name for a media tile: host plus file or folder name. */
export function mediaLabel(raw: string): string {
  const url = parse(raw);
  if (!url) return raw;
  const parts = url.pathname.split("/").filter(Boolean);
  const file = parts[parts.length - 1] ?? "";
  const generic = /^(index|master|playlist|manifest|chunklist|stream|live)(_\w+)?\.(m3u8|mpd)$/i;
  const name = generic.test(file) && parts.length > 1 ? parts[parts.length - 2] : file;
  const host = url.hostname.replace(/^www\./, "");
  return name ? `${host} · ${decodeURIComponent(name)}` : host;
}

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function proxyBase(): string {
  const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  return windows ? "http://msmedia.localhost" : "msmedia://localhost";
}

/**
 * Same stream through the desktop app's media proxy, which adds the CORS headers
 * hls.js / dash.js need. Outside the desktop app the URL is returned unchanged.
 * Mirrors `media_proxy::proxied_path` in the Rust backend.
 */
export function proxiedMediaUrl(raw: string, referer?: string): string {
  const url = parse(raw);
  if (!url || !isTauri()) return raw;
  let token = base64Url(url.origin);
  if (referer) token += `~${base64Url(referer)}`;
  return `${proxyBase()}/o/${token}${url.pathname}${url.search}`;
}
