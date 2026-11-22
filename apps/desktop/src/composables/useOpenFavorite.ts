import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "vue-i18n";
import { isTauri } from "@/lib/http";
import { toast } from "./useToast";
import { useLiveStatus } from "./useLiveStatus";
import { useStreams, type Platform } from "./useStreams";

export interface OpenableFavorite {
  channel: string;
  platform: Platform;
  iframeUrl?: string;
  siteUrl?: string;
  displayName?: string;
}

/**
 * Opens a favorite as a new tile. A YouTube channel plays its current live stream (found from the
 * live poller, or asked for), the way the Add dialog's favorites do.
 */
export function useOpenFavorite() {
  const { t } = useI18n();
  const { addStream } = useStreams();
  const { getStatus } = useLiveStatus();

  const openFavorite = async (favorite: OpenableFavorite): Promise<void> => {
    const { channel, platform } = favorite;
    const name = (favorite.displayName || channel).replace(/^@/, "");
    const handle = channel.replace(/^@/, "");
    if (platform === "custom") {
      const url = favorite.iframeUrl || favorite.siteUrl;
      if (url) addStream(channel, "custom", url, favorite.displayName);
      return;
    }
    if (platform !== "youtube") {
      addStream(channel, platform, undefined, favorite.displayName);
      return;
    }
    const status = getStatus(channel, "youtube") || getStatus(name, "youtube");
    if (status?.isLive && status.videoId) {
      addStream(status.videoId, "youtube", undefined, name, handle);
      return;
    }
    if (!isTauri()) {
      toast.error(t("toasts.youtube.offline"));
      return;
    }
    toast.info(t("toasts.youtube.detecting"), { id: "yt-detecting", duration: 8000 });
    try {
      const liveId = await invoke<string | null>("youtube_resolve_live_id", {
        channelOrHandle: channel,
      });
      toast.dismiss("yt-detecting");
      if (liveId) addStream(liveId, "youtube", undefined, name, handle);
      else toast.error(t("toasts.youtube.offline"));
    } catch (err) {
      toast.dismiss("yt-detecting");
      toast.error(String(err));
    }
  };

  return { openFavorite };
}
