import { createSharedComposable, tryOnScopeDispose } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, ref } from "vue";
import { isTauri } from "@/lib/http";
import { toast } from "@/composables/useToast";

type FitState = "on" | "off" | "none";

/**
 * "Fit the page's video to this tile" for website tiles. The page reports back whenever the
 * fit starts or ends (a click on the button, the exit chip, Esc, or the automatic fit on play).
 */
const _useFitVideo = () => {
  const fitted = ref<Record<string, boolean>>({});
  const anyFitted = computed(() => Object.values(fitted.value).some(Boolean));
  let noVideoMessage = "";
  let unlisten: UnlistenFn | null = null;
  let disposed = false;

  if (isTauri()) {
    void listen<{ tileId: string; state: FitState }>("tile-fit-state", (event) => {
      const { tileId, state } = event.payload;
      if (state === "none") {
        if (noVideoMessage) toast.info(noVideoMessage, { id: "fit-video-none" });
        return;
      }
      fitted.value = { ...fitted.value, [tileId]: state === "on" };
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
  }
  // The shared state goes away with its last user; so must the listener, or a later user would
  // add a second one next to it.
  tryOnScopeDispose(() => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  });

  const toggle = (tileId: string, message: string) => {
    if (!isTauri()) return;
    noVideoMessage = message;
    void invoke("tile_fit_video", { tileId, mode: "toggle" }).catch(() => {});
  };

  const exitAll = () => {
    if (!isTauri()) return;
    const tiles = Object.keys(fitted.value).filter((tileId) => fitted.value[tileId]);
    if (tiles.length === 0) return;
    for (const tileId of tiles)
      void invoke("tile_fit_video", { tileId, mode: "exit" }).catch(() => {});
    // Treat them as released right away: a page that never confirms (it reloaded, or it keeps
    // claiming to be fitted) must not make Escape stop leaving fullscreen for good.
    const next = { ...fitted.value };
    for (const tileId of tiles) next[tileId] = false;
    fitted.value = next;
  };

  const forget = (tileId: string) => {
    if (!(tileId in fitted.value)) return;
    const next = { ...fitted.value };
    delete next[tileId];
    fitted.value = next;
  };

  const setAuto = (enabled: boolean) => {
    if (isTauri()) void invoke("tile_fit_auto", { enabled }).catch(() => {});
  };

  return { fitted, anyFitted, toggle, exitAll, forget, setAuto };
};

export const useFitVideo = createSharedComposable(_useFitVideo);
