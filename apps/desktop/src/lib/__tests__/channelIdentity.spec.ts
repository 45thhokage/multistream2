import { describe, it, expect } from "vitest";
import { channelIdentityKey, sameChannelIdentity } from "../channelIdentity";

describe("channelIdentity unit tests", () => {
  it("should key non-custom channels by platform and lowercase name only", () => {
    // Arrange
    const withUrl = channelIdentityKey("Gaules", "twitch", "https://twitch.tv/gaules");
    const withoutUrl = channelIdentityKey("gaules", "twitch");

    // Assert
    expect(withUrl).toBe("twitch:gaules");
    expect(withoutUrl).toBe("twitch:gaules");
  });

  it("should key custom channels by full url, not just domain", () => {
    // Arrange
    const ublock = channelIdentityKey("github.com", "custom", "https://github.com/gorhill/ublock");
    const profile = channelIdentityKey("github.com", "custom", "https://github.com/gorhill/");

    // Assert
    expect(ublock).toBe("custom:github.com:https://github.com/gorhill/ublock");
    expect(profile).toBe("custom:github.com:https://github.com/gorhill/");
    expect(ublock).not.toBe(profile);
  });

  it("should match same full-url customs and reject different urls", () => {
    // Arrange
    const stored = {
      channel: "github.com",
      platform: "custom" as const,
      iframeUrl: "https://github.com/gorhill/ublock",
    };

    // Act & Assert
    expect(
      sameChannelIdentity(stored, "github.com", "custom", "https://github.com/gorhill/ublock")
    ).toBe(true);
    expect(sameChannelIdentity(stored, "github.com", "custom", "https://github.com/gorhill/")).toBe(
      false
    );
    expect(
      sameChannelIdentity(stored, "github.com", "twitch", "https://github.com/gorhill/ublock")
    ).toBe(false);
  });
});
