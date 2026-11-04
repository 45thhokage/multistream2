import { describe, it, expect, afterEach, vi } from "vitest";
import { PLATFORMS, getParentHost, getTwitchParentHosts } from "../platforms";

describe("platforms config unit tests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getParentHost()", () => {
    it("should return localhost when window hostname contains tauri", () => {
      // Arrange
      vi.stubGlobal("window", {
        location: {
          hostname: "tauri.localhost",
        },
      });

      // Act
      const host = getParentHost();

      // Assert
      expect(host).toBe("localhost");
    });

    it("should return localhost when window hostname is empty", () => {
      // Arrange
      vi.stubGlobal("window", {
        location: {
          hostname: "",
        },
      });

      // Act
      const host = getParentHost();

      // Assert
      expect(host).toBe("localhost");
    });

    it("should return the exact custom hostname when running in a standard web browser", () => {
      // Arrange
      vi.stubGlobal("window", {
        location: {
          hostname: "multistream.app",
        },
      });

      // Act
      const host = getParentHost();

      // Assert
      expect(host).toBe("multistream.app");
    });
  });

  describe("getTwitchParentHosts()", () => {
    it("should always include localhost and 127.0.0.1 alongside the primary host", () => {
      // Arrange
      const primary = "192.168.40.35";

      // Act
      const hosts = getTwitchParentHosts(primary);

      // Assert
      expect(hosts).toEqual([primary, "localhost", "127.0.0.1"]);
    });

    it("should deduplicate when the primary host is already a loopback", () => {
      // Act
      const hosts = getTwitchParentHosts("localhost");

      // Assert
      expect(hosts).toEqual(["localhost", "127.0.0.1"]);
    });
  });

  describe("Twitch platform config", () => {
    it("should generate embed URL with autoplay, muted and specified parent host", () => {
      // Arrange
      const channel = "gaules";
      const parent = "localhost";

      // Act
      const embedUrl = PLATFORMS.twitch.getEmbedUrl(channel, parent);

      // Assert
      expect(embedUrl).toBe(
        "https://player.twitch.tv/?channel=gaules&parent=localhost&parent=127.0.0.1&autoplay=true&muted=true"
      );
    });

    it("should generate chat URL with darkpopout and specified parent host", () => {
      // Arrange
      const channel = "gaules";
      const parent = "localhost";

      // Act
      const chatUrl = PLATFORMS.twitch.getChatUrl(channel, parent);

      // Assert
      expect(chatUrl).toBe(
        "https://www.twitch.tv/embed/gaules/chat?parent=localhost&parent=127.0.0.1&darkpopout=true"
      );
    });

    it("should include a custom primary host before the loopback fallbacks", () => {
      // Act
      const embedUrl = PLATFORMS.twitch.getEmbedUrl("gaules", "5173.localhost");

      // Assert
      expect(embedUrl).toBe(
        "https://player.twitch.tv/?channel=gaules&parent=5173.localhost&parent=localhost&parent=127.0.0.1&autoplay=true&muted=true"
      );
    });
  });

  describe("Kick platform config", () => {
    it("should generate player embed URL pointing to player.kick.cx", () => {
      // Arrange
      const channel = "xqc";

      // Act
      const embedUrl = PLATFORMS.kick.getEmbedUrl(channel);

      // Assert
      expect(embedUrl).toBe("https://player.kick.cx/xqc");
    });

    it("should generate chat embed URL with readonly parameter", () => {
      // Arrange
      const channel = "xqc";

      // Act
      const chatUrl = PLATFORMS.kick.getChatUrl(channel);

      // Assert
      expect(chatUrl).toBe("https://chat.kick.cx/embed/xqc?readonly=true");
    });
  });

  describe("YouTube platform config", () => {
    it("should generate player embed URL with nocookie domain and autoplay", () => {
      // Arrange
      const videoId = "dQw4w9WgXcQ";

      // Act
      const embedUrl = PLATFORMS.youtube.getEmbedUrl(videoId);

      // Assert
      expect(embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1");
    });

    it("should generate chat embed URL with dark_theme and embed_domain", () => {
      // Arrange
      const videoId = "dQw4w9WgXcQ";

      // Act
      const chatUrl = PLATFORMS.youtube.getChatUrl(videoId);

      // Assert
      expect(chatUrl).toBe(
        "https://www.youtube.com/live_chat?v=dQw4w9WgXcQ&embed_domain=localhost&dark_theme=1"
      );
    });
  });

  describe("Custom platform config", () => {
    it("should return the arbitrary URL unchanged for custom embed and chat", () => {
      // Arrange
      const customUrl = "https://example.com/custom-player?stream=1";

      // Act
      const embedUrl = PLATFORMS.custom.getEmbedUrl(customUrl);
      const chatUrl = PLATFORMS.custom.getChatUrl(customUrl);

      // Assert
      expect(embedUrl).toBe(customUrl);
      expect(chatUrl).toBe(customUrl);
    });
  });
});
