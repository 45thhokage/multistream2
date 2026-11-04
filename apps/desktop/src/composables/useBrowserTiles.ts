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
export const URL_POLL_MS = 1500;

const openTiles = new Set<string>();
const rectOkByTile = new Map<string, boolean>();
const appliedVisibilityByTile = new Map<string, boolean>();
const requestedVisibilityByTile = new Map<string, boolean>();
let titleListenerStarted = false;
let dialogObserverStarted = false;
let urlPollTimer: ReturnType<typeof setInterval> | null = null;

const _useBrowserTiles = () => {
  const overlayHidden = ref(false);
  const manuallyHidden = ref(false);
  const titles = ref<Record<string, string>>({});
  const urls = ref<Record<string, string>>({});

  const applyVisibility = (tileId: string): void => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    const visible =
      rectOkByTile.get(tileId) !== false &&
      requestedVisibilityByTile.get(tileId) !== false &&
      !overlayHidden.value &&
      !manuallyHidden.value;
    if (appliedVisibilityByTile.get(tileId) === visible) return;
    appliedVisibilityByTile.set(tileId, visible);
    invoke("tile_set_visible", { tileId, visible }).catch(() => {});
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

  const ensureDialogObserver = (): void => {
    if (dialogObserverStarted || !isTauri()) return;
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    dialogObserverStarted = true;
    const sync = (): void => {
      overlayHidden.value =
        document.querySelector('[role="dialog"], [data-native-overlay]') !== null;
      applyVisibilityToAll();
    };
    sync();
    new MutationObserver(sync).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role"],
    });
  };

  const openTile = async (
    tileId: string,
    url: string,
    rect: TileRect,
    mobile = false,
    player = false
  ): Promise<boolean> => {
    ensureTitleListener();
    ensureDialogObserver();
    ensureUrlPoller();
    if (!isTauri()) return false;
    openTiles.add(tileId);
    rectOkByTile.set(tileId, rect.width >= MIN_TILE_EDGE && rect.height >= MIN_TILE_EDGE);
    appliedVisibilityByTile.delete(tileId);
    urls.value[tileId] = url;
    try {
      await invoke<string>(player ? "open_player_webview" : "open_tile_webview", {
        tileId,
        ...(!player && { url }),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        ...(!player && { mobile }),
      });
    } catch {
      openTiles.delete(tileId);
      return false;
    }
    applyVisibility(tileId);
    return true;
  };

  const closeTile = async (tileId: string): Promise<void> => {
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

  const syncTileBounds = async (tileId: string, rect: TileRect): Promise<void> => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    rectOkByTile.set(tileId, rect.width >= MIN_TILE_EDGE && rect.height >= MIN_TILE_EDGE);
    if (rectOkByTile.get(tileId) === true) {
      await invoke("tile_set_bounds", {
        tileId,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }).catch(() => {});
    }
    applyVisibility(tileId);
  };

  const refreshTileUrl = async (tileId: string): Promise<void> => {
    if (!isTauri() || !openTiles.has(tileId)) return;
    try {
      urls.value[tileId] = await invoke<string>("tile_current_url", { tileId });
    } catch {
      // keep last known url
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
    setTilesHidden,
    setTileVisible,
  };
};

export const useBrowserTiles = createSharedComposable(_useBrowserTiles);

export function __test_resetBrowserTiles(): void {
  openTiles.clear();
  rectOkByTile.clear();
  appliedVisibilityByTile.clear();
  requestedVisibilityByTile.clear();
  titleListenerStarted = false;
  dialogObserverStarted = false;
  if (urlPollTimer) clearInterval(urlPollTimer);
  urlPollTimer = null;
}
