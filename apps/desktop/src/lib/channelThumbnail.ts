import { CDN_CONFIG } from "@/config/cdn";

export function channelThumbnail(channel: {
  platform: string;
  id: string;
  videoId?: string;
  thumbnailUrl?: string;
}): string {
  const raw =
    channel.thumbnailUrl ||
    (channel.platform === "twitch"
      ? CDN_CONFIG.twitch.previewThumbnail(channel.id)
      : channel.platform === "youtube" && channel.videoId
        ? `https://i.ytimg.com/vi/${channel.videoId}/hqdefault.jpg`
        : "");
  if (!raw) return "";
  try {
    const url = new URL(raw.replace(/\{width\}/g, "320").replace(/\{height\}/g, "180"));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}
