import { createSharedComposable } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ref } from "vue";
import { isTauri } from "@/lib/http";

export interface SiteHlsStatus {
  enabled: boolean;
  state: "searching" | "loading" | "playing" | "failed" | "off" | string;
  source?: string | null;
  url?: string | null;
  level?: string | null;
  message?: string | null;
  updatedAt: number;
}

export interface DetectedMedia {
  url: string;
  kind: "hls" | "dash" | string;
  pageUrl: string;
  detectedAt: number;
}

/**
 * Playlists seen in website tiles and the state of experimental direct playback.
 * Events come from the backend's WebView2 hooks (Windows desktop build).
 */
const _useSiteHls = () => {
  const statuses = ref<Record<string, SiteHlsStatus>>({});
  const detectedCount = ref<Record<string, number>>({});
  const supported = isTauri();

  if (supported) {
    void listen<{ tileId: string; status: SiteHlsStatus }>("site-hls-status", (event) => {
      statuses.value = { ...statuses.value, [event.payload.tileId]: event.payload.status };
    });
    void listen<{ tileId: string; url: string; kind: string }>("tile-media-detected", (event) => {
      const id = event.payload.tileId;
      detectedCount.value = { ...detectedCount.value, [id]: (detectedCount.value[id] ?? 0) + 1 };
    });
  }

  const setDirect = async (tileId: string, enabled: boolean) => {
    if (!supported) return;
    await invoke("site_hls_set", { tileId, enabled });
    if (!enabled) {
      const next = { ...statuses.value };
      delete next[tileId];
      statuses.value = next;
    }
  };

  const detected = (tileId: string) =>
    supported ? invoke<DetectedMedia[]>("tile_media_list", { tileId }) : Promise.resolve([]);

  return { statuses, detectedCount, supported, setDirect, detected };
};

export const useSiteHls = createSharedComposable(_useSiteHls);
