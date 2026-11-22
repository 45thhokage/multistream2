<script setup lang="ts">
import { useQualityBridge } from "@/composables/useStreamQuality";
import { ref, watch } from "vue";
import { emitTo } from "@tauri-apps/api/event";
import { useEventListener } from "@vueuse/core";
import { GripVertical } from "@lucide/vue";
import { useStreams, type Stream } from "@/composables/useStreams";
import { useFocusedStream } from "@/composables/useFocusedStream";
import { useLinkDrop } from "@/composables/useLinkDrop";
import { useNativePlayerBridge } from "@/composables/useNativePlayerBridge";
import { useStreamMixer } from "@/composables/useStreamMixer";
import { useWorkspaces } from "@/composables/useWorkspaces";
import { nativePlayerId } from "@/lib/nativePlayer";
import KickStream from "./KickStream.vue";
import TwitchStream from "./TwitchStream.vue";
import YoutubeStream from "./YoutubeStream.vue";
import CustomStream from "./CustomStream.vue";
import TranscriptionOverlay from "../main/TranscriptionOverlay.vue";
import ToastProvider from "../ui/toast/ToastProvider.vue";

useQualityBridge();
const id = nativePlayerId();
const mixer = useStreamMixer();
const { workspaceIdOf } = useWorkspaces();
const interact = (kind: "click" | "hover") => {
  if (!id || !stream.value) return;
  mixer.interact(id, kind, workspaceIdOf(stream.value.workspaceId));
  if (kind === "click") void emitTo("main", "ui-overlay-dismiss");
};
useNativePlayerBridge();
const { streams, activeStreams } = useStreams();
const { isFocused } = useFocusedStream();
const { onLinkDragOver, onLinkDrop, linkDragging } = useLinkDrop();
const stream = ref<Stream | null>(null);
// Keep the player mounted until its native WebView closes, even after removal.
watch(
  streams,
  (value) => {
    const current = value.find((item) => item.id === id);
    if (current) stream.value = { ...current };
    else if (stream.value) window.postMessage({ type: "MULTISTREAM_GRAVEYARD_SUSPEND" }, "*");
  },
  { immediate: true, deep: true }
);
useEventListener(window, "message", (event: MessageEvent) => {
  if (event.data?.type === "NATIVE_INTERACTION" && ["click", "hover"].includes(event.data.kind))
    interact(event.data.kind);
  if (event.data?.type === "NATIVE_ESCAPE" && id) void emitTo("main", "native-player-escape");
  if (event.data?.type === "NATIVE_EDGE" && ["left", "right"].includes(event.data.side) && id) {
    void emitTo("main", "native-player-edge", { tileId: id, side: event.data.side });
  }
});
useEventListener(window, "mousemove", (event: MouseEvent) => {
  if (!id) return;
  const side =
    event.clientX < 14 ? "left" : event.clientX > window.innerWidth - 14 ? "right" : null;
  if (side) void emitTo("main", "native-player-edge", { tileId: id, side });
});
useEventListener(window, "multistream-native-screenshot", () =>
  window.dispatchEvent(new CustomEvent("multistream-screenshot"))
);
// A press on the grip only starts a rearrange once the pointer moves, so a plain click
// never hides every player.
const DRAG_THRESHOLD_PX = 4;
const beginDrag = (event: PointerEvent) => {
  if (!id || event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  function move(next: PointerEvent) {
    // Released where this page did not see it: this is no longer the same press.
    if ((next.buttons & 1) === 0) {
      stop();
      return;
    }
    if (Math.hypot(next.clientX - startX, next.clientY - startY) < DRAG_THRESHOLD_PX) return;
    stop();
    void emitTo("main", "native-player-drag", { tileId: id });
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
};
</script>

<template>
  <div
    v-if="stream"
    class="relative h-screen w-screen overflow-hidden bg-[#0f1115] group/native"
    :data-stream-id="stream.id"
    @pointerdown.capture="interact('click')"
    @pointerenter="interact('hover')"
    @dragover="onLinkDragOver"
    @drop="onLinkDrop($event, stream.id)"
  >
    <KickStream
      v-if="stream.platform === 'kick'"
      :channel="stream.channel"
      :channelid="stream.id"
    />
    <TwitchStream
      v-else-if="stream.platform === 'twitch'"
      :channel="stream.channel"
      :channelid="stream.id"
    />
    <YoutubeStream
      v-else-if="stream.platform === 'youtube'"
      :channel="stream.channel"
      :channelid="stream.id"
      :display-name="stream.displayName"
      :handle="stream.handle"
    />
    <CustomStream
      v-else
      :channel="stream.channel"
      :channelid="stream.id"
      :iframe-url="stream.iframeUrl || ''"
    />
    <TranscriptionOverlay v-if="isFocused(stream.id) || activeStreams.length === 1" />
    <div v-if="linkDragging" class="absolute inset-0 z-40 bg-white/5" />
    <button
      type="button"
      class="absolute top-3 left-1/2 -translate-x-1/2 z-50 rounded-md border border-white/10 bg-black/60 p-1.5 text-gray-300 opacity-0 group-hover/native:opacity-100 focus-visible:opacity-100 cursor-grab"
      :aria-label="$t('mixer.dragTile')"
      :title="$t('mixer.dragTile')"
      @pointerdown="beginDrag"
    >
      <GripVertical class="size-4" aria-hidden="true" />
    </button>
    <ToastProvider />
  </div>
</template>
