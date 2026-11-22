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

  const stubDocument = (selectors: Record<string, unknown>) => {
    const querySelector = vi.fn((selector: string) => selectors[selector] ?? null);
    const body = { dispatchEvent: vi.fn() };
    let syncOverlay: (() => void) | undefined;
    vi.stubGlobal("document", { querySelector, body });
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          syncOverlay = callback;
        }
        observe() {}
      }
    );
    return {
      selectors,
      body,
      querySelector,
      sync: () => syncOverlay?.(),
    };
  };
  const dialogElement = {
    isConnected: true,
    getBoundingClientRect: () => ({ left: 100.4, top: 50, right: 500.2, bottom: 350 }),
  };

  it("should park native tiles behind native overlays and restore them without reopening", async () => {
    // Arrange
    const doc = stubDocument({});
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 640, height: 360 });
    vi.clearAllMocks();

    // Act
    doc.selectors["[data-native-overlay]"] = {};
    doc.sync();

    // Assert
    expect(invokeMock).toHaveBeenCalledWith("tile_set_visible", {
      tileId: "abc",
      visible: false,
      park: true,
    });

    // Act
    delete doc.selectors["[data-native-overlay]"];
    doc.sync();

    // Assert
    expect(invokeMock).toHaveBeenLastCalledWith("tile_set_visible", {
      tileId: "abc",
      visible: true,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("open_tile_webview", expect.anything());
  });

  it("should keep tiles visible and cut the dialog out of them", async () => {
    // Arrange
    invokeMock.mockResolvedValue(true);
    const doc = stubDocument({});
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 640, height: 360 });
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(true);

    // Act
    doc.selectors['[role="dialog"]'] = dialogElement;
    doc.sync();

    // Assert
    expect(invokeMock).toHaveBeenCalledWith("tiles_set_cutout", {
      rects: [{ x: 100, y: 50, width: 401, height: 300 }],
    });
    expect(invokeMock).not.toHaveBeenCalledWith("tile_set_visible", expect.anything());

    // Act
    delete doc.selectors['[role="dialog"]'];
    doc.sync();

    // Assert
    expect(invokeMock).toHaveBeenLastCalledWith("tiles_set_cutout", { rects: [] });
  });

  it("should cut out a right-click menu, and a menu over a dialog extends the hole", async () => {
    // Arrange
    const doc = stubDocument({});
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 640, height: 360 });
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(true);

    // Act: a menu on its own
    doc.selectors['[role="menu"]'] = {
      isConnected: true,
      getBoundingClientRect: () => ({ left: 10, top: 20, right: 190, bottom: 60 }),
    };
    doc.sync();

    // Assert
    expect(invokeMock).toHaveBeenCalledWith("tiles_set_cutout", {
      rects: [{ x: 10, y: 20, width: 180, height: 40 }],
    });

    // Act: the same menu opened over a dialog
    doc.selectors['[role="dialog"]'] = dialogElement;
    doc.sync();

    // Assert: one hole covering both
    expect(invokeMock).toHaveBeenLastCalledWith("tiles_set_cutout", {
      rects: [{ x: 10, y: 20, width: 491, height: 330 }],
    });
  });

  it("should keep tiles playing and cut a hole per revealed side panel", async () => {
    // Arrange
    invokeMock.mockResolvedValue(true);
    const doc = stubDocument({});
    const panel = (left: number, right: number) => ({
      isConnected: true,
      getBoundingClientRect: () => ({ left, top: 0, right, bottom: 720 }),
    });
    (document as unknown as { querySelectorAll: () => unknown[] }).querySelectorAll = () => [
      panel(0, 224),
      panel(1200, 1280),
    ];

    // Act: opening a tile starts watching the page, which already has both panels showing
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 640, height: 360 });
    doc.sync();

    // Assert: two separate holes, so the video between the panels is never covered
    expect(invokeMock).toHaveBeenCalledWith("tiles_set_cutout", {
      rects: [
        { x: 0, y: 0, width: 224, height: 720 },
        { x: 1200, y: 0, width: 80, height: 720 },
      ],
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "tile_set_visible",
      expect.objectContaining({ visible: false })
    );
  });

  it("should close an open dialog when a stream tile is clicked", async () => {
    // Arrange
    invokeMock.mockResolvedValue(true);
    const handlers: Record<string, () => void> = {};
    listenMock.mockImplementation((event: string, cb: () => void) => {
      handlers[event] = cb;
      return Promise.resolve(vi.fn());
    });
    vi.stubGlobal(
      "PointerEvent",
      class {
        type: string;
        init: object;
        constructor(type: string, init: object) {
          this.type = type;
          this.init = init;
        }
      }
    );
    const doc = stubDocument({});
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 640, height: 360 });

    // Act: a tile click with no dialog open does nothing
    handlers["ui-overlay-dismiss"]?.();

    // Assert
    expect(doc.body.dispatchEvent).not.toHaveBeenCalled();

    // Act: with a dialog open it replays an outside press
    doc.selectors['[role="dialog"]'] = dialogElement;
    handlers["ui-overlay-dismiss"]?.();

    // Assert
    expect(doc.body.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(doc.body.dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: "pointerdown" });
  });

  it("should park tiles behind a dialog when the platform cannot cut it out", async () => {
    // Arrange
    invokeMock.mockResolvedValue(false);
    const doc = stubDocument({});
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 640, height: 360 });
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(false);

    // Act
    doc.selectors['[role="dialog"]'] = dialogElement;
    doc.sync();
    await Promise.resolve();
    await Promise.resolve();

    // Assert
    expect(invokeMock).toHaveBeenCalledWith("tile_set_visible", {
      tileId: "abc",
      visible: false,
      park: true,
    });
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
    expect(invokeMock).not.toHaveBeenCalledWith("tile_set_bounds_batch", expect.anything());
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
    expect(invokeMock).toHaveBeenCalledWith("tile_set_bounds_batch", {
      tiles: [{ tileId: "abc", x: 5, y: 6, width: 320, height: 180 }],
    });
  });

  it("should move every tile of one frame with a single ordered backend call", async () => {
    // Arrange
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    await sut.openTile("def", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    vi.clearAllMocks();
    invokeMock.mockImplementation(
      async (command: string, args: { tiles?: { tileId: string }[] }) =>
        command === "tile_set_bounds_batch" ? args.tiles?.map((tile) => tile.tileId) : undefined
    );

    // Act
    const results = await Promise.all([
      sut.syncTileBounds("abc", { x: 1, y: 1, width: 50, height: 50 }),
      sut.syncTileBounds("def", { x: 60, y: 1, width: 50, height: 50 }),
      sut.syncTileBounds("abc", { x: 2, y: 2, width: 60, height: 60 }),
    ]);

    // Assert
    const batches = invokeMock.mock.calls.filter(
      ([command]) => command === "tile_set_bounds_batch"
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[1]?.tiles).toEqual([
      { tileId: "abc", x: 2, y: 2, width: 60, height: 60 },
      { tileId: "def", x: 60, y: 1, width: 50, height: 50 },
    ]);
    expect(results).toEqual([true, true, true]);
  });

  it("should report a rejected batch as not positioned so the rect is sent again", async () => {
    // Arrange
    await sut.openTile("abc", "https://example.com/", { x: 0, y: 0, width: 100, height: 100 });
    vi.clearAllMocks();
    invokeMock.mockRejectedValue(new Error("busy"));

    // Act
    const result = await sut.syncTileBounds("abc", { x: 1, y: 1, width: 50, height: 50 });

    // Assert
    expect(result).toBe(false);
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
      sniff: false,
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
  it("waits for native creation before caching visibility during startup", async () => {
    // Arrange
    let finish!: (value: string) => void;
    invokeMock.mockImplementation((command: string) =>
      command === "open_player_webview"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve()
    );
    const opening = sut.openTile(
      "restored",
      "",
      { x: 0, y: 0, width: 640, height: 360 },
      false,
      true
    );
    // Act
    sut.setTileVisible("restored", true);
    sut.setTilesHidden(true);
    sut.setTilesHidden(false);
    const beforeReady = invokeMock.mock.calls.filter(([command]) => command === "tile_set_visible");
    finish("tile-restored");
    await opening;
    // Assert
    expect(beforeReady).toEqual([]);
    expect(invokeMock).toHaveBeenLastCalledWith("tile_set_visible", {
      tileId: "restored",
      visible: true,
    });
  });
  it("closes a tile that was closed while its native view was still being created", async () => {
    // Arrange
    let finish!: (value: string) => void;
    invokeMock.mockImplementation((command: string) =>
      command === "open_tile_webview"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve()
    );
    const opening = sut.openTile("gone", "https://example.com/", {
      x: 0,
      y: 0,
      width: 640,
      height: 360,
    });

    // Act: removed before creation finished, then creation completes
    await sut.closeTile("gone");
    invokeMock.mockClear();
    finish("tile-gone");
    const opened = await opening;

    // Assert: the late view is closed again, never shown, and no longer tracked
    expect(opened).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("close_tile_webview", { tileId: "gone" });
    expect(invokeMock).not.toHaveBeenCalledWith("tile_set_visible", expect.anything());
    invokeMock.mockClear();
    await sut.syncTileBounds("gone", { x: 0, y: 0, width: 640, height: 360 });
    expect(invokeMock).not.toHaveBeenCalled();
  });
  it("retries a failed native show even when the requested visibility has not changed", async () => {
    // Arrange
    let failShow = true;
    invokeMock.mockImplementation((command: string) => {
      if (command === "tile_set_visible" && failShow) {
        failShow = false;
        return Promise.reject(Error("not ready"));
      }
      return Promise.resolve("tile-restored");
    });
    await sut.openTile("restored", "", { x: 0, y: 0, width: 640, height: 360 }, false, true);
    await Promise.resolve();
    vi.clearAllMocks();
    // Act
    sut.setTileVisible("restored", true);
    // Assert
    expect(invokeMock).toHaveBeenCalledWith("tile_set_visible", {
      tileId: "restored",
      visible: true,
    });
  });
  it("reports failed bounds so the surface can retry the same rectangle", async () => {
    // Arrange
    const rect = { x: 0, y: 0, width: 640, height: 360 };
    await sut.openTile("bounds", "", rect, false, true);
    invokeMock.mockRejectedValueOnce(Error("not positioned"));
    invokeMock.mockResolvedValueOnce(["bounds"]);
    // Act
    const failed = await sut.syncTileBounds("bounds", rect);
    const retried = await sut.syncTileBounds("bounds", rect);
    // Assert
    expect(failed).toBe(false);
    expect(retried).toBe(true);
  });
});
