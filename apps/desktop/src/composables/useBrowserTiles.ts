import { createSharedComposable } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ref } from "vue";
import { isTauri } from "@/lib/http";

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TileTitleChangedPayload {
  tileId: string;
  title: string;
}

const MIN_TILE_EDGE = 2;
// Surfaces drawn over the page that must stay visible above the native tiles.
const OVERLAY_SELECTORS = ['[role="dialog"]', '[role="menu"]'];
// Page UI that slides over the tiles (e.g. immersive-mode side panels). Each marked element gets
// its own hole in the tiles, so the streams behind it never stop showing.
const CUTOUT_SELECTOR = "[data-native-cutout]";
export const URL_POLL_MS = 1500;

const openTiles = new Set<string>();
const rectOkByTile = new Map<string, boolean>();
type TileMode = "visible" | "parked" | "hidden";
const appliedVisibilityByTile = new Map<string, TileMode>();
const requestedVisibilityByTile = new Map<string, boolean>();
// Tiles covered by a maximized tile: parked off-screen (still playing) until it is restored.
const coveredTiles = new Set<string>();
// Tiles whose native creation is still in flight, and those closed meanwhile.
const openingTiles = new Map<string, number>();
const closedWhileOpening = new Set<string>();
let titleListenerStarted = false;
let dialogObserverStarted = false;
let urlPollTimer: ReturnType<typeof setInterval> | null = null;
// Where supported, an open dialog is shown through a hole cut in the native tiles so streams stay
// visible. null = not probed yet, false = unsupported (tiles are parked instead).
let cutoutSupported: boolean | null = null;
let lastCutoutKey = "";
let cutoutFrame = 0;

interface BoundsBatch {
  rects: Map<string, TileRect>;
  applied: Promise<Set<string>>;
}

let boundsBatch: BoundsBatch | null = null;
let boundsInFlight: Promise<unknown> = Promise.resolve();

// Tiles are separate native views, so a layout animation moves all of them every frame.
// Coalescing the frame's rects into one ordered IPC call keeps them moving together.
const queueBounds = (tileId: string, rect: TileRect): Promise<boolean> => {
  if (!boundsBatch) {
    const rects = new Map<string, TileRect>();
    const applied = new Promise<Set<string>>((resolve) => {
      setTimeout(() => {
        boundsBatch = null;
        const tiles = Array.from(rects, ([id, { x, y, width, height }]) => ({
          tileId: id,
          x,
          y,
          width,
          height,
        }));
        boundsInFlight = boundsInFlight
          .then(() => invoke<string[]>("tile_set_bounds_batch", { tiles }))
          .then((ids) => resolve(new Set(ids)))
          .catch(() => resolve(new Set<string>()));
      }, 0);
    });
    boundsBatch = { rects, applied };
  }
  const batch = boundsBatch;
  batch.rects.set(tileId, rect);
  return batch.applied.then((ids) => ids.has(tileId));
};

const openOverlays = (): Element[] =>
  OVERLAY_SELECTORS.map((selector) => document.querySelector(selector)).filter(
    (element): element is Element => element !== null
  );

const cutoutLayers = (): Element[] =>
  Array.from(document.querySelectorAll?.(CUTOUT_SELECTOR) ?? []);

const boundsOf = (layers: Element[]): TileRect | null => {
  const boxes = layers.map((layer) => layer.getBoundingClientRect());
  if (boxes.length === 0) return null;
  const x = Math.floor(Math.min(...boxes.map((box) => box.left)));
  const y = Math.floor(Math.min(...boxes.map((box) => box.top)));
  const right = Math.ceil(Math.max(...boxes.map((box) => box.right)));
  const bottom = Math.ceil(Math.max(...boxes.map((box) => box.bottom)));
  return { x, y, width: right - x, height: bottom - y };
};

const _useBrowserTiles = () => {
  const overlayHidden = ref(false);
  const manuallyHidden = ref(false);
  const titles = ref<Record<string, string>>({});
  const urls = ref<Record<string, string>>({});

  const applyVisibility = (tileId: string): void => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    // Hiding a native view stops its video. A dialog only needs the view out of its way,
    // so when nothing else forces it hidden the tile is parked off-screen and keeps playing.
    const shown =
      rectOkByTile.get(tileId) !== false && requestedVisibilityByTile.get(tileId) !== false;
    const covered = overlayHidden.value || manuallyHidden.value || coveredTiles.has(tileId);
    const mode: TileMode = !shown ? "hidden" : covered ? "parked" : "visible";
    if (appliedVisibilityByTile.get(tileId) === mode) return;
    appliedVisibilityByTile.set(tileId, mode);
    invoke("tile_set_visible", {
      tileId,
      visible: mode === "visible",
      ...(mode === "parked" && { park: true }),
    }).catch(() => {
      if (appliedVisibilityByTile.get(tileId) === mode) appliedVisibilityByTile.delete(tileId);
    });
  };

  const applyVisibilityToAll = (): void => {
    openTiles.forEach((tileId) => applyVisibility(tileId));
  };

  const ensureTitleListener = (): void => {
    if (titleListenerStarted || !isTauri()) return;
    titleListenerStarted = true;
    void listen<TileTitleChangedPayload>("tile-title-changed", (event) => {
      titles.value[event.payload.tileId] = event.payload.title;
    }).catch(() => {
      titleListenerStarted = false;
    });
  };

  const pushCutout = (rects: TileRect[], resync: () => void): void => {
    const key = rects.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`).join("|");
    if (key === lastCutoutKey) return;
    lastCutoutKey = key;
    invoke<boolean>("tiles_set_cutout", { rects })
      .then((supported) => {
        if (supported || rects.length === 0) return;
        cutoutSupported = false;
        resync();
      })
      .catch(() => {
        if (rects.length === 0) return;
        cutoutSupported = false;
        resync();
      });
  };

  // Dialogs and panels animate and resize, so follow them while they are open. With a menu open
  // over a dialog, one hole covers both; each cutout panel gets a hole of its own.
  const trackCutout = (overlays: Element[], panels: Element[], resync: () => void): void => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(cutoutFrame);
    const measurable = (layers: Element[]) =>
      layers.filter((layer) => typeof layer.getBoundingClientRect === "function");
    const overlayLayers = measurable(overlays);
    const panelLayers = measurable(panels);
    if (overlayLayers.length === 0 && panelLayers.length === 0) {
      pushCutout([], resync);
      return;
    }
    const measure = (): void => {
      const live = (layers: Element[]) => layers.filter((layer) => layer.isConnected);
      const liveOverlays = live(overlayLayers);
      const livePanels = live(panelLayers);
      if (liveOverlays.length + livePanels.length === 0 || cutoutSupported === false) return;
      const rects = [
        boundsOf(liveOverlays),
        ...livePanels.map((panel) => boundsOf([panel])),
      ].filter((rect): rect is TileRect => rect !== null);
      pushCutout(rects, resync);
      if (typeof requestAnimationFrame === "function") {
        cutoutFrame = requestAnimationFrame(measure);
      }
    };
    measure();
  };

  const ensureDialogObserver = (): void => {
    if (dialogObserverStarted || !isTauri()) return;
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    dialogObserverStarted = true;
    const sync = (): void => {
      const layers = openOverlays();
      const panels = cutoutLayers();
      const nativeOverlay = document.querySelector("[data-native-overlay]");
      // Dialogs, menus and sliding panels show through the tiles; only native overlays (drags)
      // still need them parked.
      const shown = layers.length + panels.length > 0;
      const cutOut = shown && nativeOverlay === null && cutoutSupported !== false;
      overlayHidden.value = nativeOverlay !== null || (shown && !cutOut);
      applyVisibilityToAll();
      trackCutout(cutOut ? layers : [], cutOut ? panels : [], sync);
    };
    sync();
    // A click on a stream tile never reaches the page, so it cannot dismiss an open dialog by
    // itself. Tiles report their clicks; replay one as an outside press so the dialog closes
    // exactly as if the backdrop had been clicked (and still honours prevented dismissals).
    void listen("ui-overlay-dismiss", () => {
      if (openOverlays().length === 0) return;
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 })
      );
    }).catch(() => {});
    // Native visibility can drift from the cache (e.g. tiles created before the window is shown);
    // re-assert it whenever the window comes back so tiles never stay invisible.
    const reassert = (): void => {
      lastCutoutKey = "";
      appliedVisibilityByTile.clear();
      applyVisibilityToAll();
    };
    window.addEventListener?.("focus", reassert);
    document.addEventListener?.("visibilitychange", () => {
      if (document.visibilityState === "visible") reassert();
    });
    new MutationObserver(sync).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // data-native-overlay can be toggled on an element that already exists (the drag shield in
      // StreamGrid stays mounted when a link drag starts during a tile drag).
      attributeFilter: ["role", "data-native-cutout", "data-native-overlay"],
    });
  };

  const openTile = async (
    tileId: string,
    url: string,
    rect: TileRect,
    mobile = false,
    player = false,
    sniff = false
  ): Promise<boolean> => {
    ensureTitleListener();
    ensureDialogObserver();
    ensureUrlPoller();
    if (!isTauri()) return false;
    rectOkByTile.set(tileId, rect.width >= MIN_TILE_EDGE && rect.height >= MIN_TILE_EDGE);
    appliedVisibilityByTile.delete(tileId);
    urls.value[tileId] = url;
    // A newer open supersedes a close that happened during an earlier, still pending open.
    closedWhileOpening.delete(tileId);
    openingTiles.set(tileId, (openingTiles.get(tileId) ?? 0) + 1);
    try {
      await invoke<string>(player ? "open_player_webview" : "open_tile_webview", {
        tileId,
        ...(!player && { url }),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        ...(!player && { mobile }),
        ...(player && { sniff }),
      });
    } catch {
      openTiles.delete(tileId);
      closedWhileOpening.delete(tileId);
      return false;
    } finally {
      const pending = (openingTiles.get(tileId) ?? 1) - 1;
      if (pending > 0) openingTiles.set(tileId, pending);
      else openingTiles.delete(tileId);
    }
    // Closed while it was being created (e.g. the tile was removed or unmounted): the close ran
    // before the native view existed, so close it now instead of resurrecting it over the grid.
    if (closedWhileOpening.delete(tileId)) {
      await invoke("close_tile_webview", { tileId }).catch(() => {});
      return false;
    }
    // Creation finishes by hiding the native view; only now can visibility be applied.
    openTiles.add(tileId);
    appliedVisibilityByTile.delete(tileId);
    applyVisibility(tileId);
    return true;
  };

  const closeTile = async (tileId: string): Promise<void> => {
    if (openingTiles.has(tileId)) closedWhileOpening.add(tileId);
    openTiles.delete(tileId);
    rectOkByTile.delete(tileId);
    appliedVisibilityByTile.delete(tileId);
    requestedVisibilityByTile.delete(tileId);
    delete titles.value[tileId];
    delete urls.value[tileId];
    if (!isTauri()) return;
    await invoke("close_tile_webview", { tileId }).catch(() => {});
  };

  const navigateTile = async (tileId: string, url: string): Promise<void> => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    urls.value[tileId] = url;
    await invoke("tile_navigate", { tileId, url }).catch(() => {});
  };

  const reloadTile = async (tileId: string): Promise<void> => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    await invoke("tile_reload", { tileId }).catch(() => {});
    await refreshTileUrl(tileId);
  };

  const goBackTile = async (tileId: string): Promise<void> => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    await invoke("tile_go_back", { tileId }).catch(() => {});
  };

  const goForwardTile = async (tileId: string): Promise<void> => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    await invoke("tile_go_forward", { tileId }).catch(() => {});
  };

  const syncTileBounds = async (tileId: string, rect: TileRect): Promise<boolean> => {
    if (!isTauri() || !openTiles.has(tileId)) return false;
    rectOkByTile.set(tileId, rect.width >= MIN_TILE_EDGE && rect.height >= MIN_TILE_EDGE);
    if (rectOkByTile.get(tileId) === true) {
      const positioned = await queueBounds(tileId, rect);
      applyVisibility(tileId);
      return positioned;
    }
    applyVisibility(tileId);
    return false;
  };

  const refreshTileUrl = async (tileId: string): Promise<void> => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    try {
      urls.value[tileId] = await invoke<string>("tile_current_url", { tileId });
    } catch {
      // keep last known url
    }
  };

  /**
   * The page a tile's native view is on right now, or null if it has no view. A view outlives a
   * reload of the app's own page, so this is where the tile really is after one.
   */
  const liveTileUrl = async (tileId: string): Promise<string | null> => {
    if (!isTauri()) return null;
    try {
      return await invoke<string>("tile_current_url", { tileId });
    } catch {
      return null;
    }
  };

  const ensureUrlPoller = (): void => {
    if (urlPollTimer !== null || typeof setInterval === "undefined") return;
    urlPollTimer = setInterval(() => {
      openTiles.forEach((tileId) => {
        void refreshTileUrl(tileId);
      });
    }, URL_POLL_MS);
  };

  const setTilesHidden = (hidden: boolean): void => {
    manuallyHidden.value = hidden;
    applyVisibilityToAll();
  };

  const setTileVisible = (tileId: string, visible: boolean): void => {
    requestedVisibilityByTile.set(tileId, visible);
    applyVisibility(tileId);
  };

  /** Park a tile out of sight while another tile is maximized over it; it keeps playing. */
  const setTileCovered = (tileId: string, covered: boolean): void => {
    if (coveredTiles.has(tileId) === covered) return;
    if (covered) coveredTiles.add(tileId);
    else coveredTiles.delete(tileId);
    applyVisibility(tileId);
  };

  return {
    titles,
    urls,
    overlayHidden,
    openTile,
    closeTile,
    navigateTile,
    reloadTile,
    goBackTile,
    goForwardTile,
    syncTileBounds,
    refreshTileUrl,
    liveTileUrl,
    setTilesHidden,
    setTileVisible,
    setTileCovered,
  };
};

export const useBrowserTiles = createSharedComposable(_useBrowserTiles);

export function __test_resetBrowserTiles(): void {
  openTiles.clear();
  rectOkByTile.clear();
  appliedVisibilityByTile.clear();
  requestedVisibilityByTile.clear();
  coveredTiles.clear();
  openingTiles.clear();
  closedWhileOpening.clear();
  titleListenerStarted = false;
  dialogObserverStarted = false;
  cutoutSupported = null;
  lastCutoutKey = "";
  if (urlPollTimer) clearInterval(urlPollTimer);
  urlPollTimer = null;
}
