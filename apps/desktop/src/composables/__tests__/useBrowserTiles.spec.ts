import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useBrowserTiles, __test_resetBrowserTiles, URL_POLL_MS } from "../useBrowserTiles";

const invokeMock = invoke as ReturnType<typeof vi.fn>;
const listenMock = listen as ReturnType<typeof vi.fn>;

describe("useBrowserTiles composable unit tests", () => {
  let sut: ReturnType<typeof useBrowserTiles>;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    __test_resetBrowserTiles();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invokeMock.mockResolvedValue("tile-abc");
    listenMock.mockResolvedValue(vi.fn());

    sut = useBrowserTiles();
    sut.titles.value = {};
    sut.urls.value = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should open a tile webview with mapped command args", async () => {
    // Arrange
    const rect = { x: 10, y: 20, width: 640, height: 360 };

    // Act
    await sut.openTile("abc", "https://www.google.com/", rect);

    // Assert
    expect(invokeMock).toHaveBeenCalledWith("open_tile_webview", {
      tileId: "abc",
      url: "https://www.google.com/",
      x: 10,
      y: 20,
      width: 640,
      height: 360,
      mobile: false,
    });
    expect(sut.urls.value["abc"]).toBe("https://www.google.com/");
  });

  it("should open a tile webview in mobile view when requested", async () => {
    // Arrange
    const rect = { x: 0, y: 0, width: 320, height: 600 };

    // Act
    await sut.openTile("abc", "https://example.com/", rect, true);

    // Assert
    expect(invokeMock).toHaveBeenCalledWith(
      "open_tile_webview",
      expect.objectContaining({ tileId: "abc", mobile: true })
    );
  });

  it("should hide native tiles behind modal dialogs and restore them without reopening", async () => {
    // Arrange
    const querySelector = vi.fn().mockReturnValue(null);
    let syncOverlay: (() => void) | undefined;
    vi.stubGlobal("document", { querySelector, body: {} });
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          syncOverlay = callback;
        }
        observe() {}
      }
    );
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 640, height: 360 });
    vi.clearAllMocks();

    // Act
    querySelector.mockReturnValue({});
    syncOverlay?.();

    // Assert
    expect(querySelector).toHaveBeenCalledWith('[role="dialog"], [data-native-overlay]');
    expect(invokeMock).toHaveBeenCalledWith("tile_set_visible", { tileId: "abc", visible: false });

    // Act
    querySelector.mockReturnValue(null);
    syncOverlay?.();

    // Assert
    expect(invokeMock).toHaveBeenLastCalledWith("tile_set_visible", {
      tileId: "abc",
      visible: true,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("open_tile_webview", expect.anything());
  });

  it("should close a tile webview and forget its state", async () => {
    // Arrange
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    vi.clearAllMocks();

    // Act
    await sut.closeTile("abc");

    // Assert
    expect(invokeMock).toHaveBeenCalledWith("close_tile_webview", { tileId: "abc" });
    expect(sut.urls.value["abc"]).toBeUndefined();
  });

  it("should navigate a tile and track the new url", async () => {
    // Arrange
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    vi.clearAllMocks();

    // Act
    await sut.navigateTile("abc", "https://example.com/next");

    // Assert
    expect(invokeMock).toHaveBeenCalledWith("tile_navigate", {
      tileId: "abc",
      url: "https://example.com/next",
    });
    expect(sut.urls.value["abc"]).toBe("https://example.com/next");
  });

  it("should hide instead of positioning a tile with a collapsed rect", async () => {
    // Arrange
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    vi.clearAllMocks();

    // Act
    await sut.syncTileBounds("abc", { x: 0, y: 0, width: 0, height: 0 });

    // Assert
    expect(invokeMock).not.toHaveBeenCalledWith(
      "tile_set_bounds",
      expect.objectContaining({ tileId: "abc" })
    );
    expect(invokeMock).toHaveBeenCalledWith("tile_set_visible", {
      tileId: "abc",
      visible: false,
    });
  });

  it("should push healthy rects to the backend", async () => {
    // Arrange
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    vi.clearAllMocks();

    // Act
    await sut.syncTileBounds("abc", { x: 5, y: 6, width: 320, height: 180 });

    // Assert
    expect(invokeMock).toHaveBeenCalledWith("tile_set_bounds", {
      tileId: "abc",
      x: 5,
      y: 6,
      width: 320,
      height: 180,
    });
  });

  it("should apply document titles pushed by the backend", async () => {
    // Arrange
    const captured: {
      fn: ((event: { payload: { tileId: string; title: string } }) => void) | null;
    } = { fn: null };
    listenMock.mockImplementation((event: string, cb: typeof captured.fn) => {
      if (event === "tile-title-changed") captured.fn = cb;
      return Promise.resolve(vi.fn());
    });

    // Act
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    captured.fn?.({ payload: { tileId: "abc", title: "Example Domain" } });

    // Assert
    expect(sut.titles.value["abc"]).toBe("Example Domain");
  });

  it("should drop a tile when the backend refuses to open it", async () => {
    // Arrange
    invokeMock.mockRejectedValueOnce(new Error("nope"));

    // Act
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    vi.clearAllMocks();
    await sut.syncTileBounds("abc", { x: 0, y: 0, width: 100, height: 100 });

    // Assert
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("should poll open tiles for in-tile navigation url changes", async () => {
    // Arrange
    vi.useFakeTimers();
    try {
      await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
      invokeMock.mockResolvedValue("https://example.com/navigated");

      // Act
      await vi.advanceTimersByTimeAsync(URL_POLL_MS);

      // Assert
      expect(invokeMock).toHaveBeenCalledWith("tile_current_url", { tileId: "abc" });
      expect(sut.urls.value["abc"]).toBe("https://example.com/navigated");
    } finally {
      vi.useRealTimers();
    }
  });

  it("should stop polling a tile after it is closed", async () => {
    // Arrange
    vi.useFakeTimers();
    try {
      await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
      await sut.closeTile("abc");
      vi.clearAllMocks();

      // Act
      await vi.advanceTimersByTimeAsync(URL_POLL_MS * 2);

      // Assert
      expect(invokeMock).not.toHaveBeenCalledWith(
        "tile_current_url",
        expect.objectContaining({ tileId: "abc" })
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("opens player surfaces through the dedicated local-page command", async () => {
    // Arrange
    const rect = { x: 10, y: 20, width: 640, height: 360 };
    // Act
    const opened = await sut.openTile("player-one", "", rect, false, true);
    // Assert
    expect(opened).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("open_player_webview", {
      tileId: "player-one",
      ...rect,
    });
  });

  it("hides an inactive workspace player without reopening or stopping it", async () => {
    // Arrange
    await sut.openTile("room-one", "", { x: 0, y: 0, width: 640, height: 360 }, false, true);
    vi.clearAllMocks();
    // Act
    sut.setTileVisible("room-one", false);
    sut.setTileVisible("room-one", true);
    // Assert
    expect(invokeMock).toHaveBeenCalledWith("tile_set_visible", {
      tileId: "room-one",
      visible: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("tile_set_visible", {
      tileId: "room-one",
      visible: true,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("close_tile_webview", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("open_player_webview", expect.anything());
  });
});
