import type { Platform } from "@/composables/useStreams";

export interface ChannelIdentity {
  channel: string;
  platform: Platform;
  iframeUrl?: string;
}

export function channelIdentityKey(
  channel: string,
  platform: Platform,
  iframeUrl?: string
): string {
  const base = `${platform}:${channel.toLowerCase()}`;
  if (platform !== "custom") return base;
  return `${base}:${iframeUrl ?? ""}`;
}

export function sameChannelIdentity(
  a: ChannelIdentity,
  channel: string,
  platform: Platform,
  iframeUrl?: string
): boolean {
  return (
    channelIdentityKey(a.channel, a.platform, a.iframeUrl) ===
    channelIdentityKey(channel, platform, iframeUrl)
  );
}
