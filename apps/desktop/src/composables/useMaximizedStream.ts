import { useStorage } from "@vueuse/core";

/**
 * Maximize: one tile fills the whole grid until it is restored (adapted from Multi Worldview's
 * maximize). Unlike Focus, which moves a stream into the layout's main slot, this ignores the
 * layout. The other tiles stay mounted and keep playing out of sight, so restoring is instant.
 *
 * Kept in localStorage because native player tiles render their toolbar in their own WebView:
 * the storage event is what carries a click there to the main window (Focus works the same way).
 * The main window clears it on startup, so the app always opens on the normal grid.
 */
const KEY = "multistream-maximized-id";
let maximizedStreamId: ReturnType<typeof useStorage<string | null>> | null = null;

export function useMaximizedStream() {
  maximizedStreamId ??= useStorage<string | null>(KEY, null);
  const state = maximizedStreamId;
  const isMaximized = (id: string) => state.value === id;
  const toggleMaximize = (id: string) => {
    state.value = state.value === id ? null : id;
  };
  const restore = () => {
    state.value = null;
  };
  return { maximizedStreamId: state, isMaximized, toggleMaximize, restore };
}
