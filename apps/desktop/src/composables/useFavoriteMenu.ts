import { ref } from "vue";
import type { Platform } from "./useStreams";

export interface FavoriteMenuTarget {
  channel: string;
  platform: Platform;
  iframeUrl?: string;
  siteUrl?: string;
  displayName?: string;
}

const target = ref<FavoriteMenuTarget | null>(null);
const position = ref({ x: 0, y: 0 });

/** Right-click menu for a channel or favorite: one shared instance, opened from any list. */
export function useFavoriteMenu() {
  const open = (event: MouseEvent, channel: FavoriteMenuTarget): void => {
    event.preventDefault();
    event.stopPropagation();
    position.value = { x: event.clientX, y: event.clientY };
    target.value = channel;
  };
  const close = (): void => {
    target.value = null;
  };
  return { target, position, open, close };
}
