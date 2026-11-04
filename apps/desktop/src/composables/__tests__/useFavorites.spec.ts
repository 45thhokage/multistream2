import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useFavorites } from "../useFavorites";

describe("useFavorites composable unit tests", () => {
  let sut: ReturnType<typeof useFavorites>;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    // mock Date.now()
    vi.useFakeTimers();

    sut = useFavorites();
    sut.clearFavorites();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should add a new favorite channel to the top of the list", () => {
    // Arrange
    const { addFavorite, favorites } = sut;
    const now = 1700000000000;
    vi.setSystemTime(new Date(now));

    // Act
    addFavorite("gaules", "twitch");

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.channel).toBe("gaules");
    expect(favorites.value[0]?.platform).toBe("twitch");
    expect(favorites.value[0]?.addedAt).toBe(now);
  });

  it("should not add duplicate stream and should silently return", () => {
    // Arrange
    const { addFavorite, favorites } = sut;
    const initialTime = 1700000000000;
    vi.setSystemTime(new Date(initialTime));

    // Act
    addFavorite("alanzoka", "twitch");

    // Assert (before duplicate addition)
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.addedAt).toBe(initialTime); // Top

    // Act (try to add alanzoka again to check if it blocks)
    vi.setSystemTime(new Date(1700000005000));
    addFavorite("alanzoka", "twitch");

    // Assert (ensure it didn't update timestamp or position)
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.channel).toBe("alanzoka");
    expect(favorites.value[0]?.addedAt).toBe(initialTime);
  });

  it("should block duplicates even if they have different casing", () => {
    // Arrange
    const { addFavorite, favorites } = sut;

    // Act
    addFavorite("Gaules", "twitch");
    addFavorite("gauLeS", "twitch");

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.channel).toBe("Gaules");
  });

  it("should allow adding iframeUrl param", () => {
    // Arrange
    const { addFavorite, favorites } = sut;

    // Act
    addFavorite("caze", "youtube", "https://iframe.youtube/caze");

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.iframeUrl).toBe("https://iframe.youtube/caze");
  });

  it("should allow same channel name if platforms are different", () => {
    // Arrange
    const { addFavorite, favorites } = sut;

    // Act
    addFavorite("ninja", "twitch");
    addFavorite("ninja", "kick");

    // Assert
    expect(favorites.value.length).toBe(2);
  });

  it("should remove a favorite channel properly", () => {
    // Arrange
    const { addFavorite, removeFavorite, favorites } = sut;

    addFavorite("mch", "twitch");
    addFavorite("robb", "youtube");

    expect(favorites.value.length).toBe(2);

    // Act
    removeFavorite("McH", "twitch"); // Should be case-insensitive remove

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.channel).toBe("robb");
  });

  it("should prevent duplicate YouTube favorite when channel has leading @", () => {
    // Arrange
    const { addFavorite, favorites } = sut;

    // Act
    addFavorite("CazeTV", "youtube");
    addFavorite("@CazeTV", "youtube");

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.channel).toBe("CazeTV");
  });

  it("should remove YouTube favorite when channel has or omits leading @", () => {
    // Arrange
    const { addFavorite, removeFavorite, favorites } = sut;
    addFavorite("CazeTV", "youtube");

    // Act
    removeFavorite("@cazetv", "youtube");

    // Assert
    expect(favorites.value.length).toBe(0);
  });

  it("should allow different custom streams with the same name if iframeUrls differ", () => {
    // Arrange
    const { addFavorite, favorites } = sut;

    // Act
    addFavorite("Custom Stream", "custom", "https://site1.com/embed");
    addFavorite("Custom Stream", "custom", "https://site2.com/embed");

    // Assert
    expect(favorites.value.length).toBe(2);
    expect(favorites.value[0]?.iframeUrl).toBe("https://site2.com/embed");
    expect(favorites.value[1]?.iframeUrl).toBe("https://site1.com/embed");
  });

  it("should prevent duplicate custom streams with the same iframeUrl", () => {
    // Arrange
    const { addFavorite, favorites } = sut;

    // Act
    addFavorite("Stream 1", "custom", "https://site.com/embed");
    addFavorite("Stream 2", "custom", "https://site.com/embed");

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.channel).toBe("Stream 1");
  });

  it("should remove custom stream properly using iframeUrl", () => {
    // Arrange
    const { addFavorite, removeFavorite, favorites } = sut;
    addFavorite("Custom Stream", "custom", "https://site1.com/embed");
    addFavorite("Custom Stream", "custom", "https://site2.com/embed");
    expect(favorites.value.length).toBe(2);

    // Act
    removeFavorite("Custom Stream", "custom", "https://site1.com/embed");

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.iframeUrl).toBe("https://site2.com/embed");
  });

  it("should clear all favorites", () => {
    // Arrange
    const { addFavorite, clearFavorites, favorites } = sut;

    addFavorite("s1", "twitch");
    addFavorite("s2", "twitch");
    addFavorite("s3", "kick");

    expect(favorites.value.length).toBe(3);

    // Act
    clearFavorites();

    // Assert
    expect(favorites.value.length).toBe(0);
  });

  it("should store site meta for custom favorites", () => {
    // Arrange
    const { addFavorite, favorites } = sut;

    // Act
    addFavorite("GitHub", "custom", "https://github.com/ilanzgx", {
      displayName: "GitHub",
      faviconUrl: "https://github.com/favicon.ico",
      siteUrl: "https://github.com/ilanzgx",
    });

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]).toMatchObject({
      channel: "GitHub",
      platform: "custom",
      iframeUrl: "https://github.com/ilanzgx",
      displayName: "GitHub",
      faviconUrl: "https://github.com/favicon.ico",
      siteUrl: "https://github.com/ilanzgx",
    });
  });

  it("should treat same-named customs with different urls as distinct", () => {
    // Arrange
    const { addFavorite, removeFavorite, favorites } = sut;

    // Act
    addFavorite("GitHub", "custom", "https://github.com/a");
    addFavorite("GitHub", "custom", "https://github.com/b");

    // Assert
    expect(favorites.value.length).toBe(2);

    // Act
    removeFavorite("GitHub", "custom", "https://github.com/a");

    // Assert
    expect(favorites.value.length).toBe(1);
    expect(favorites.value[0]?.iframeUrl).toBe("https://github.com/b");
  });

  it("should keep same-domain custom urls as separate favorites with their own favicons", () => {
    // Arrange
    const { addFavorite, favorites } = sut;

    // Act
    addFavorite("github.com", "custom", "https://github.com/gorhill/ublock", {
      displayName: "uBlock Origin",
      faviconUrl: "https://github.com/favicon.ico",
      siteUrl: "https://github.com/gorhill/ublock",
    });
    addFavorite("github.com", "custom", "https://github.com/gorhill/", {
      displayName: "gorhill",
      faviconUrl: "https://github.com/favicon.ico",
      siteUrl: "https://github.com/gorhill/",
    });

    // Assert
    expect(favorites.value.length).toBe(2);
    const urls = favorites.value.map((f) => f.iframeUrl).toSorted();
    expect(urls).toEqual(["https://github.com/gorhill/", "https://github.com/gorhill/ublock"]);
    expect(
      favorites.value.find((f) => f.iframeUrl === "https://github.com/gorhill/ublock")
    ).toMatchObject({ displayName: "uBlock Origin" });
    expect(
      favorites.value.find((f) => f.iframeUrl === "https://github.com/gorhill/")
    ).toMatchObject({ displayName: "gorhill" });
  });
});
