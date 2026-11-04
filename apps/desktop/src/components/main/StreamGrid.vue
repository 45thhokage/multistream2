<script lang="ts" setup>
import { useLinkDrop } from "@/composables/useLinkDrop";
import NativeStreamSurface from "@/components/stream/NativeStreamSurface.vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useBrowserTiles } from "@/composables/useBrowserTiles";
import { nativeOutputAvailable } from "@/lib/nativePlayer";
import { usesPlayerSurface } from "@/lib/nativePlayer";
import KickStream from "@/components/stream/KickStream.vue";
import TwitchStream from "@/components/stream/TwitchStream.vue";
import YoutubeStream from "@/components/stream/YoutubeStream.vue";
import CustomStream from "@/components/stream/CustomStream.vue";
import TranscriptionOverlay from "./TranscriptionOverlay.vue";
import { GripVertical, Plus } from "@lucide/vue";
import { useDragAndDrop } from "@/composables/useDragAndDrop";
import { useStreams, type Stream } from "@/composables/useStreams";
import { useFocusedStream } from "@/composables/useFocusedStream";
import { usePreferences } from "@/composables/usePreferences";
import { useCustomLayouts } from "@/composables/useCustomLayouts";
import { useWorkspaces } from "@/composables/useWorkspaces";
import { arrangeCustomStreams, arrangeStreams, resolveLayout } from "@/config/layouts";
import { computed, watch, nextTick, ref, onMounted, onBeforeUnmount } from "vue";
import { useEventListener } from "@vueuse/core";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const { onLinkDrop, onLinkDragOver, linkDragging } = useLinkDrop();

const { streams, isLeaving, getStreamKey } = useStreams();
const { focusedStreamId, isFocused } = useFocusedStream();
const {
  draggingId,
  overId,
  isDragging,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onMouseUp,
  onGlobalMouseUp,
} = useDragAndDrop();
const { setTilesHidden } = useBrowserTiles();
let stopNativeDrag: UnlistenFn | undefined;
let disposed = false;
onMounted(async () => {
  if (!nativeOutputAvailable()) return;
  const unlisten = await listen<{ tileId: string }>("native-player-drag", (event) => {
    if (streams.value.some((stream) => stream.id === event.payload?.tileId))
      onMouseDown(event.payload.tileId);
  });
  if (disposed) unlisten();
  else stopNativeDrag = unlisten;
});
onBeforeUnmount(() => {
  disposed = true;
  stopNativeDrag?.();
});
watch(isDragging, (value) => {
  if (nativeOutputAvailable()) setTilesHidden(value);
});
const { setSelectedChat, nativePlayerEnabled, streamLayout } = usePreferences();
const { customLayouts } = useCustomLayouts();
const { workspaces, activeWorkspaceId, workspaceIdOf } = useWorkspaces();

watch(nativePlayerEnabled, () => {
  // Immediately purge dead Twitch streams from the graveyard when Twitch player mode changes
  domStreams.value = domStreams.value.filter((ds) => !(ds._isDead && ds.platform === "twitch"));
});

useEventListener(window, "mouseup", onGlobalMouseUp);

type DomStream = Stream & { _isDead?: boolean };
const domStreams = ref<DomStream[]>([]);

const layoutId = computed(() => streamLayout.value);
const customDef = computed(() => customLayouts.value.find((c) => c.id === streamLayout.value));

const streamsForWorkspace = (workspaceId: string) =>
  streams.value.filter((s) => workspaceIdOf(s.workspaceId) === workspaceId);

const arrangedByWorkspace = computed(() => {
  const map: Record<string, ReturnType<typeof arrangeStreams>> = {};
  for (const ws of workspaces.value) {
    const list = streamsForWorkspace(ws.id);
    map[ws.id] = customDef.value
      ? arrangeCustomStreams(customDef.value, list, focusedStreamId.value)
      : arrangeStreams(resolveLayout(streamLayout.value), list, focusedStreamId.value);
  }
  return map;
});

const activeArranged = computed(
  () =>
    arrangedByWorkspace.value[activeWorkspaceId.value] ?? {
      container: {},
      placedById: {},
      mainId: null,
      overlay: false,
      emptySlots: 0,
      emptyPlacements: [],
      expanded: false,
    }
);

const pauseIframe = (id: string) => {
  const iframe = document.querySelector(`[data-stream-id="${id}"] iframe`) as HTMLIFrameElement;
  if (iframe && iframe.contentWindow) {
    // CRITICAL: DO NOT use the word "pause" in this message type (e.g. MULTISTREAM_GRAVEYARD_PAUSE)!
    // Some injected third-party scripts actively hook window.addEventListener('message')
    // and aggressively drop ANY cross-frame message containing the substring "pause"
    // in its keys/values. If you use "pause", this graveyard mechanism will be
    // completely ignored and the audio will keep playing in the background.
    iframe.contentWindow.postMessage({ type: "MULTISTREAM_GRAVEYARD_SUSPEND" }, "*");
  }
};

watch(
  streams,
  (newStreams) => {
    const nextStreams = [...domStreams.value];

    // 1. Mark removed streams as dead (DO NOT remove from array)
    nextStreams.forEach((ds) => {
      const isStillAlive = newStreams.some((s) => s.id === ds.id);
      if (!isStillAlive && !ds._isDead) {
        ds._isDead = true;
        pauseIframe(ds.id);
      }
    });

    // 2. Add new streams
    newStreams.forEach((s) => {
      const existing = nextStreams.find((ds) => ds.id === s.id);
      if (!existing) {
        nextStreams.push({ ...s, _isDead: false });
      } else if (existing._isDead) {
        // If it was dead and came back (unlikely to have the same ID, but for safety)
        existing._isDead = false;
      }
    });

    // 3. Garbage Collector: Remove dead streams
    const activePlatforms = new Set(newStreams.map((s) => s.platform));

    domStreams.value = nextStreams.filter((ds) => {
      if (!ds._isDead) return true;

      // Custom streams always bypass the graveyard
      if (ds.platform === "custom") return false;

      // Twitch streams bypass the graveyard when Native HLS player is enabled
      if (ds.platform === "twitch" && nativePlayerEnabled.value) return false;

      // Otherwise keep in graveyard as long as there are active streams of that platform
      return activePlatforms.has(ds.platform);
    });
  },
  { deep: true, immediate: true }
);

// auto-select the chat of the focused stream
watch(focusedStreamId, async (newId) => {
  if (!newId) return;
  const stream = streams.value.find((s) => s.id === newId);
  if (stream && stream.platform !== "custom")
    setSelectedChat(`${stream.platform}:${stream.channel}`);
});

// FLIP animation: streams physically slide to their new layout positions.
// Layout switches only change styles of stable keyed nodes, so iframes keep playing.
async function playFlipAnimation() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // 1. FIRST: capture current bounding rect of every stream element
  const elements = document.querySelectorAll<HTMLElement>("[data-stream-id]");
  const prevRects = new Map<string, DOMRect>();
  elements.forEach((el) => {
    prevRects.set(el.dataset.streamId!, el.getBoundingClientRect());
  });

  // 2. Let Vue apply the new layout
  await nextTick();

  // 3. LAST + INVERT + PLAY
  elements.forEach((el) => {
    const id = el.dataset.streamId!;
    const prev = prevRects.get(id);
    if (!prev) return;

    // Newly shown or newly hidden elements have no meaningful previous rect — skip
    if (prev.width < 2 || prev.height < 2) return;

    const next = el.getBoundingClientRect();
    if (next.width < 2 || next.height < 2) return;

    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    const scaleX = prev.width / (next.width || 1);
    const scaleY = prev.height / (next.height || 1);

    // Nothing moved — skip
    if (
      Math.abs(dx) < 1 &&
      Math.abs(dy) < 1 &&
      Math.abs(scaleX - 1) < 0.01 &&
      Math.abs(scaleY - 1) < 0.01
    )
      return;

    // Snap element back to its OLD position via inverse transform
    el.style.transition = "none";
    el.style.transformOrigin = "top left";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;

    // Force paint, then animate to the new (real) position
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)";
        el.style.transform = "";
      });
    });
  });
}

watch([focusedStreamId, layoutId], playFlipAnimation);

const isHiddenByLayout = (workspaceId: string, streamId: string) =>
  arrangedByWorkspace.value[workspaceId]?.placedById[streamId]?.hidden ?? false;

const isOverlayItem = (workspaceId: string, streamId: string) =>
  (arrangedByWorkspace.value[workspaceId]?.placedById[streamId]?.overlayIndex ?? -1) >= 0;

const getItemStyle = (workspaceId: string, streamId: string) =>
  arrangedByWorkspace.value[workspaceId]?.placedById[streamId]?.style ?? {};

const isSpanLastOdd = (workspaceId: string, streamId: string) =>
  arrangedByWorkspace.value[workspaceId]?.placedById[streamId]?.spanLastOdd ?? false;

const domStreamsForWorkspace = (workspaceId: string) =>
  domStreams.value.filter((ds) => workspaceIdOf(ds.workspaceId) === workspaceId);

const openAddDialog = () => {
  window.dispatchEvent(new CustomEvent("multistream-show-dialog", { detail: "add-stream" }));
};
</script>

<template>
  <!-- Every workspace stays mounted so switching rooms never pauses playback.
       Inactive rooms keep their layout boxes (visibility:hidden) instead of
       display:none so players never consider themselves hidden. -->
  <div class="h-full overflow-hidden select-none relative">
    <div
      v-for="ws in workspaces"
      :key="ws.id"
      :data-testid="`workspace-grid-${ws.id}`"
      :aria-hidden="ws.id !== activeWorkspaceId"
      :style="arrangedByWorkspace[ws.id]?.container"
      :class="ws.id === activeWorkspaceId ? 'h-full' : 'absolute inset-0 invisible'"
    >
      <div
        v-for="stream in domStreamsForWorkspace(ws.id)"
        v-show="!stream._isDead && !isHiddenByLayout(ws.id, stream.id)"
        :key="getStreamKey(stream)"
        :data-stream-id="stream.id"
        :data-testid="`stream-item-${stream.channel}`"
        :style="getItemStyle(ws.id, stream.id)"
        :class="[
          isSpanLastOdd(ws.id, stream.id) ? 'col-span-2 justify-self-center w-1/2' : '',
          'min-h-0 min-w-0 stream-item overflow-hidden rounded-sm relative group/grid-item',
          isOverlayItem(ws.id, stream.id)
            ? 'ring-1 ring-white/20 shadow-xl shadow-black/50 rounded-md'
            : '',
          isLeaving(stream.id) ? 'stream-leaving' : '',
          draggingId === stream.id ? 'opacity-50' : '',
        ]"
        @dragover="onLinkDragOver"
        @drop.stop="onLinkDrop($event, stream.id)"
        @mouseenter="onMouseEnter(stream.id)"
        @mouseleave="onMouseLeave"
        @mouseup="onMouseUp(stream.id)"
      >
        <div
          v-if="isDragging || linkDragging"
          :data-native-overlay="linkDragging ? true : undefined"
          :class="[
            'absolute inset-0 z-40 transition-colors',
            overId === stream.id && draggingId !== stream.id
              ? 'bg-blue-500/10 ring-2 ring-blue-500'
              : 'bg-transparent',
          ]"
        />

        <div
          :class="[
            'absolute z-50 opacity-0 group-hover/grid-item:opacity-100 transition-opacity cursor-grab p-1.5 rounded-md bg-black/60 border border-white/10 hover:bg-black/80 text-white/50 hover:text-white',
            'top-3 left-1/2 -translate-x-1/2',
            isDragging ? 'cursor-grabbing' : '',
          ]"
          @mousedown.stop="onMouseDown(stream.id)"
        >
          <GripVertical class="size-4 pointer-events-none" />
        </div>

        <TranscriptionOverlay
          v-if="
            !usesPlayerSurface(stream) &&
            (isFocused(stream.id) || streamsForWorkspace(ws.id).length === 1)
          "
        />

        <NativeStreamSurface
          v-if="usesPlayerSurface(stream)"
          :stream-id="stream.id"
          :dead="stream._isDead"
          :visible="
            ws.id === activeWorkspaceId && !stream._isDead && !isHiddenByLayout(ws.id, stream.id)
          "
        />
        <KickStream
          v-else-if="stream.platform === 'kick'"
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
          v-else-if="stream.platform === 'custom'"
          :channel="stream.channel"
          :channelid="stream.id"
          :iframe-url="stream.iframeUrl || ''"
        />
      </div>

      <!-- Empty slots visualize the selected grid shape and add streams in one click -->
      <template v-if="ws.id === activeWorkspaceId">
        <button
          v-for="slot in activeArranged.emptyPlacements"
          :key="`placeholder-${slot.index}`"
          :data-layout-slot="slot.index"
          :style="{ ...slot.style, zIndex: slot.overlayIndex >= 0 ? slot.style.zIndex : '1' }"
          data-testid="layout-placeholder"
          class="min-h-0 min-w-0 rounded-sm border border-dashed border-[#3a3f4b] bg-white/[0.02] hover:bg-[#3b82f6]/10 hover:border-[#5b8def] transition-colors cursor-pointer flex items-center justify-center group/placeholder"
          :aria-label="t('layouts.addToSlot')"
          @dragover="onLinkDragOver"
          @drop.stop="onLinkDrop($event)"
          @click="openAddDialog"
        >
          <Plus class="size-6 text-gray-600 group-hover/placeholder:text-white transition-colors" />
        </button>
      </template>
    </div>
  </div>
</template>
<style scoped>
/* Stream enter animation — plays once when the element is inserted */
.stream-item {
  animation: stream-enter 0.35s ease;
  transition:
    grid-column 0.45s cubic-bezier(0.25, 0.8, 0.25, 1),
    grid-row 0.45s cubic-bezier(0.25, 0.8, 0.25, 1);
}

/* Stream leave animation — two-phase: fade out in place, then remove from DOM */
.stream-leaving {
  opacity: 0;
  transform: scale(0.95);
  pointer-events: none;
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

@keyframes stream-enter {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
}
</style>
