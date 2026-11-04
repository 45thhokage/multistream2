import { describe, expect, it } from "vitest";
import { channelThumbnail } from "../channelThumbnail";

describe("channel thumbnails", () => {
  it("falls back to the channel CDN when Twitch status has no thumbnail", () => {
    // Arrange
    const channel = { platform: "twitch", id: "Shroud" };
    // Act
    const url = channelThumbnail(channel);
    // Assert
    expect(url).toBe("https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-320x180.jpg");
  });
  it("expands API thumbnail size placeholders", () => {
    // Arrange
    const channel = {
      platform: "kick",
      id: "x",
      thumbnailUrl: "https://cdn.example/{width}x{height}.jpg",
    };
    // Act
    const url = channelThumbnail(channel);
    // Assert
    expect(url).toBe("https://cdn.example/320x180.jpg");
  });
  it("uses a YouTube video thumbnail and rejects unsupported protocols", () => {
    // Arrange
    const youtube = { platform: "youtube", id: "x", videoId: "abcdefghijk" };
    const unsafe = { platform: "custom", id: "x", thumbnailUrl: "javascript:alert(1)" };
    // Act
    const results = [channelThumbnail(youtube), channelThumbnail(unsafe)];
    // Assert
    expect(results).toEqual(["https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", ""]);
  });
});
