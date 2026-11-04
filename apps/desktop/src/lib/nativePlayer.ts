import { isTauri } from "./http";
import type { Stream } from "@/composables/useStreams";
import { customEmbedRoute } from "./customEmbed";

export function nativeOutputAvailable(): boolean {
  return isTauri() && typeof navigator !== "undefined" && navigator.platform.startsWith("Win");
}

export function nativePlayerId(): string | null {
  if (typeof location === "undefined") return null;
  const id = new URLSearchParams(location.search).get("nativePlayer");
  return id && /^[a-zA-Z0-9_-]{1,40}$/.test(id) ? id : null;
}

export function usesPlayerSurface(stream: Stream): boolean {
  return (
    nativeOutputAvailable() &&
    (stream.platform !== "custom" || customEmbedRoute(stream.iframeUrl || "").kind !== "browser")
  );
}
