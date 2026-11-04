import { describe, it, expect } from "vitest";
import {
  customEmbedRoute,
  isOfficialEmbedPlayerUrl,
  normalizeCustomEmbedUrl,
} from "../customEmbed";

describe("customEmbed unit tests", () => {
  it("should pass tiktok watch urls through untouched for browser tiles", () => {
    // Arrange
    const inputs = [
      "https://www.tiktok.com/@someuser/video/7263847263847263",
      "https://m.tiktok.com/v/7263847263847263.html",
      "tiktok.com/@someuser/video/7263847263847263?lang=en",
    ];

    // Act
    const results = inputs.map(normalizeCustomEmbedUrl);

    // Assert
    expect(results).toEqual([
      "https://www.tiktok.com/@someuser/video/7263847263847263",
      "https://m.tiktok.com/v/7263847263847263.html",
      "https://tiktok.com/@someuser/video/7263847263847263?lang=en",
    ]);
  });

  it("should rewrite redgifs watch urls to the ifr player", () => {
    // Arrange
    const inputs = [
      "https://www.redgifs.com/watch/unselfishgrandhyena",
      "https://redgifs.com/ifr/unselfishgrandhyena",
      "redgifs.com/watch/unselfishgrandhyena?x=1",
    ];

    // Act
    const results = inputs.map(normalizeCustomEmbedUrl);

    // Assert
    expect(results).toEqual([
      "https://www.redgifs.com/ifr/unselfishgrandhyena",
      "https://www.redgifs.com/ifr/unselfishgrandhyena",
      "https://www.redgifs.com/ifr/unselfishgrandhyena",
    ]);
  });

  it("should pass unrelated urls through canonicalized", () => {
    // Arrange
    const input = "https://player.vimeo.com/video/803623";

    // Act
    const result = normalizeCustomEmbedUrl(input);

    // Assert
    expect(result).toBe("https://player.vimeo.com/video/803623");
  });

  it("should canonicalize bare hosts and pass through non-http schemes untouched", () => {
    // Arrange
    const inputs = ["  notaurl  ", "javascript:alert(1)"];

    // Act
    const results = inputs.map(normalizeCustomEmbedUrl);

    // Assert
    expect(results).toEqual(["https://notaurl/", "javascript:alert(1)"]);
  });

  it("should rewrite instagram post and reel urls to the embed endpoint", () => {
    // Arrange
    const inputs = [
      "https://www.instagram.com/p/C8abcDEF123/",
      "https://www.instagram.com/reel/C8abcDEF123/?x=1",
      "instagram.com/reels/C8abcDEF123",
    ];

    // Act
    const results = inputs.map(normalizeCustomEmbedUrl);

    // Assert
    expect(results).toEqual([
      "https://www.instagram.com/p/C8abcDEF123/embed",
      "https://www.instagram.com/reel/C8abcDEF123/embed",
      "https://www.instagram.com/reel/C8abcDEF123/embed",
    ]);
  });

  it("should route every regular site to a native browser tile", () => {
    // Arrange
    const inputs = [
      "https://www.google.com/search?q=cats",
      "https://github.com/ilanzgx/multistream",
      "example.com/some/page",
      "https://www.tiktok.com/@user/video/7263847263847263",
    ];

    // Act
    const results = inputs.map(customEmbedRoute);

    // Assert
    expect(results).toEqual([
      { kind: "browser", url: "https://www.google.com/search?q=cats" },
      { kind: "browser", url: "https://github.com/ilanzgx/multistream" },
      { kind: "browser", url: "https://example.com/some/page" },
      { kind: "browser", url: "https://www.tiktok.com/@user/video/7263847263847263" },
    ]);
  });

  it("should keep official embed players on the iframe route", () => {
    // Arrange
    const inputs = [
      "https://www.instagram.com/p/C8abcDEF123/",
      "https://player.vimeo.com/video/803623",
    ];

    // Act
    const results = inputs.map(customEmbedRoute);

    // Assert
    expect(results).toEqual([
      { kind: "player", url: "https://www.instagram.com/p/C8abcDEF123/embed" },
      { kind: "player", url: "https://player.vimeo.com/video/803623" },
    ]);
  });

  it("should detect official embed player urls", () => {
    // Arrange
    const players = [
      "https://www.redgifs.com/ifr/unselfishgrandhyena",
      "https://www.instagram.com/reel/C8abcDEF123/embed",
      "https://player.vimeo.com/video/803623",
    ];
    const browsers = [
      "https://www.google.com/",
      "https://github.com/ilanzgx",
      "https://www.tiktok.com/@user/video/7263847263847263",
    ];

    // Act
    const playerResults = players.map(isOfficialEmbedPlayerUrl);
    const browserResults = browsers.map(isOfficialEmbedPlayerUrl);

    // Assert
    expect(playerResults).toEqual([true, true, true]);
    expect(browserResults).toEqual([false, false, false]);
  });

  it("should pass unparseable input through the browser route", () => {
    // Arrange
    const input = "javascript:alert(1)";

    // Act
    const result = customEmbedRoute(input);

    // Assert
    expect(result).toEqual({ kind: "browser", url: "javascript:alert(1)" });
  });
});
