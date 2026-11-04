import { onMounted, onScopeDispose, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { nativeOutputAvailable, nativePlayerId } from "@/lib/nativePlayer";
import { useLiveStatus, type LiveStatus } from "./useLiveStatus";

export function useNativePlayerBridge(
  onShortcut?: (key: string) => void,
  onEdge?: (tileId: string, side: string) => void
) {
  const { statuses } = useLiveStatus();
  const id = nativePlayerId();
  const cleanup: UnlistenFn[] = [];
  let disposed = false;
  const register = async <T>(name: string, callback: (payload: T) => void) => {
    const unlisten = await listen<T>(name, (event) => callback(event.payload));
    if (disposed) unlisten();
    else cleanup.push(unlisten);
  };
  onMounted(async () => {
    if (!nativeOutputAvailable()) return;
    if (id) {
      await register<Record<string, LiveStatus>>("native-player-status", (value) => {
        statuses.value = value;
      });
      await register("native-player-screenshot", () =>
        window.dispatchEvent(new CustomEvent("multistream-screenshot"))
      );
      await emitTo("main", "native-player-ready", { tileId: id });
    } else {
      await register<{ key: string }>("native-player-shortcut", (value) => {
        if (typeof value?.key === "string") onShortcut?.(value.key);
      });
      await register<{ tileId: string; side: string }>("native-player-edge", (value) => {
        if (typeof value?.tileId === "string" && ["left", "right"].includes(value.side))
          onEdge?.(value.tileId, value.side);
      });
      await register<{ tileId: string }>("native-player-ready", (value) => {
        if (typeof value?.tileId === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(value.tileId)) {
          void emitTo(`tile-${value.tileId}`, "native-player-status", statuses.value);
        }
      });
    }
  });
  watch(
    statuses,
    (value) => {
      if (nativeOutputAvailable() && !id) void emit("native-player-status", value);
    },
    { deep: true }
  );
  useEventListener(window, "multistream-screenshot", () => {
    if (nativeOutputAvailable() && !id) void emit("native-player-screenshot");
  });
  onScopeDispose(() => {
    disposed = true;
    cleanup.forEach((unlisten) => unlisten());
  });
}
