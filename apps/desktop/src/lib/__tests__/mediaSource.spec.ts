import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaKindOf, mediaLabel, proxiedMediaUrl } from "../mediaSource";
import { customEmbedRoute } from "../customEmbed";

describe("mediaSource unit tests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies hls, dash and direct files by path", () => {
    // Arrange
    const inputs = [
      "https://cdn.example.com/live/master.m3u8?token=abc",
      "https://cdn.example.com/vod/manifest.mpd",
      "https://cdn.example.com/clip.MP4",
      "https://site.example.com/room",
      "ftp://cdn.example.com/a.m3u8",
    ];
    // Act
    const kinds = inputs.map(mediaKindOf);
    // Assert
    expect(kinds).toEqual(["hls", "dash", "file", null, null]);
  });

  it("routes media links to the native player instead of a browser tile", () => {
    // Arrange
    const url = "https://cdn.example.com/live/master.m3u8";
    // Act
    const route = customEmbedRoute(url);
    // Assert
    expect(route).toEqual({ kind: "media", url, media: "hls" });
  });

  it("names tiles by host and a meaningful path segment", () => {
    // Arrange / Act / Assert
    expect(mediaLabel("https://www.cdn.example.com/channels/news/master.m3u8")).toBe(
      "cdn.example.com · news"
    );
    expect(mediaLabel("https://cdn.example.com/videos/My%20Clip.mp4")).toBe(
      "cdn.example.com · My Clip.mp4"
    );
  });

  it("leaves urls untouched outside the desktop app", () => {
    // Arrange
    const url = "https://cdn.example.com/live/master.m3u8";
    // Act
    const proxied = proxiedMediaUrl(url);
    // Assert
    expect(proxied).toBe(url);
  });

  it("encodes the origin into a proxy path that keeps path and query", () => {
    // Arrange
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const url = "https://cdn.example.com:8443/live/a/master.m3u8?token=x%2Fy";
    // Act
    const proxied = proxiedMediaUrl(url);
    // Assert
    const token = btoa("https://cdn.example.com:8443")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(proxied.endsWith(`/o/${token}/live/a/master.m3u8?token=x%2Fy`)).toBe(true);
    expect(
      proxied.startsWith("msmedia://localhost") || proxied.startsWith("http://msmedia.localhost")
    ).toBe(true);
  });
});
