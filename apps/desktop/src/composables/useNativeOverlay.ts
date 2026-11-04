import { onScopeDispose, ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { nativeOutputAvailable } from "@/lib/nativePlayer";
import type { TileRect } from "./useBrowserTiles";

let owner: symbol | null = null;
let closeOwner: (() => void) | null = null;
let operations: Promise<unknown> = Promise.resolve();

export function useNativeOverlay(kind: "layout" | "preview") {
  const available = nativeOutputAvailable();
  const opened = ref(false);
  const token = Symbol(kind);
  let disposed = false;
  const enqueue = (operation: () => Promise<unknown>) => {
    operations = operations.catch(() => {}).then(operation);
    return operations;
  };
  const close = () => {
    opened.value = false;
    if (owner !== token) return;
    owner = null;
    closeOwner = null;
    void enqueue(() => invoke("close_ui_overlay")).catch(() => {});
  };
  const show = (rect: TileRect, data: Record<string, string> = {}) => {
    if (!available || disposed) return;
    if (owner !== token) closeOwner?.();
    owner = token;
    closeOwner = close;
    opened.value = true;
    void enqueue(async () => {
      if (owner !== token || disposed) return;
      await invoke("open_ui_overlay", { kind, data: JSON.stringify(data), ...rect });
    }).catch(() => {
      if (owner === token) close();
    });
  };
  let unlisten: (() => void) | undefined;
  if (available) {
    void listen("ui-overlay-dismiss", close).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    useEventListener(window, "resize", close);
    useEventListener(window, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    });
  }
  onScopeDispose(() => {
    disposed = true;
    close();
    unlisten?.();
  });
  return { available, opened, show, close };
}
