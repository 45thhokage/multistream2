<script lang="ts" setup>
import { useLinkDrop } from "@/composables/useLinkDrop";
import NativeStreamSurface from "@/components/stream/NativeStreamSurface.vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
import { useMaximizedStream } from "@/composables/useMaximizedStream";
import { useBrowserTiles } from "@/composables/useBrowserTiles";
import { usePreferences } from "@/composables/usePreferences";
import { useCustomLayouts } from "@/composables/useCustomLayouts";
import { useWorkspaces } from "@/composables/useWorkspaces";
import { arrangeCustomStreams, arrangeStreams, resolveLayout } from "@/config/layouts";
import { computed, watch, nextTick, ref, onMounted, onBeforeUnmount } from "vue";
import { useEventListener } from "@vueuse/core";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const { onLinkDrop, onLinkDragOver, linkDragging } = useLinkDrop();

const { streams, isLeaving, getStreamKey, pendingSlot } = useStreams();
const { focusedStreamId, isFocused } = useFocusedStream();
const {
  draggingId,
  overId,
  overSlot,
  isDragging,
  onMouseDown,
  beginDragOnMove,
  onMouseEnter,
  onMouseLeave,
  onMouseUp,
  onSlotEnter,
  onSlotLeave,
  onSlotMouseUp,
  onGlobalMouseUp,
  cancelDrag,
} = useDragAndDrop();
let stopNativeDrag: UnlistenFn | undefined;
let stopDragPointer: UnlistenFn | undefined;
let disposed = false;
onMounted(async () => {
  if (!nativeOutputAvailable()) return;
  const unlisten = await listen<{ tileId: string }>("native-player-drag", (event) => {
    if (streams.value.some((stream) => stream.id === event.payload?.tileId))
      onMouseDown(event.payload.tileId);
  });
  if (disposed) unlisten();
  else stopNativeDrag = unlisten;
  const unlistenPointer = await listen<DragPointer>("drag-pointer", (event) =>
    onDragPointer(event.payload)
  );
  if (disposed) unlistenPointer();
  else stopDragPointer = unlistenPointer;
});
onBeforeUnmount(() => {
  disposed = true;
  stopNativeDrag?.();
  stopDragPointer?.();
});

// Streams stay visible and playing while one is dragged. A native stream under the cursor swallows
// the mouse, so the drag is followed through the OS cursor instead: the cell under the pointer is
// the target, and releasing the button drops on it.
interface DragPointer {
  x: number;
  y: number;
  down: boolean;
}
const cellAt = (x: number, y: number): { id?: string; slot?: number } => {
  const root = grid.value?.querySelector(
    `[data-testid="workspace-grid-${activeWorkspaceId.value}"]`
  );
  let best: { id?: string; slot?: number; area: number } | null = null;
  root?.querySelectorAll<HTMLElement>("[data-stream-id], [data-layout-slot]").forEach((element) => {
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return;
    const area = box.width * box.height;
    if (best && area >= best.area) return;
    const slot = element.dataset.layoutSlot;
    best =
      slot !== undefined ? { slot: Number(slot), area } : { id: element.dataset.streamId, area };
  });
  return best ?? {};
};
const onDragPointer = ({ x, y, down }: DragPointer) => {
  if (!isDragging.value) return;
  const { id, slot } = cellAt(x, y);
  if (down) {
    if (slot !== undefined) onSlotEnter(slot);
    else if (id !== undefined && id !== draggingId.value) onMouseEnter(id);
    else {
      onMouseLeave();
      onSlotLeave();
    }
    return;
  }
  if (slot !== undefined) {
    onSlotEnter(slot);
    onSlotMouseUp(slotOfStream);
  } else if (id !== undefined && id !== draggingId.value) {
    onMouseEnter(id);
    onMouseUp(id, slotOfStream);
  } else cancelDrag();
};
watch(isDragging, (dragging) => {
  if (nativeOutputAvailable())
    void invoke("drag_pointer_watch", { active: dragging }).catch(() => {});
});
const { setSelectedChat, nativePlayerEnabled, streamLayout } = usePreferences();
const { customLayouts } = useCustomLayouts();
const { workspaces, activeWorkspaceId, workspaceIdOf } = useWorkspaces();

watch(nativePlayerEnabled, () => {
  // Immediately purge dead Twitch streams from the graveyard when Twitch player mode changes
  domStreams.value = domStreams.value.filter((ds) => !(ds._isDead && ds.platform === "twitch"));
});

useEventListener(window, "mouseup", onGlobalMouseUp);

useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape" && isDragging.value) cancelDrag();
});

type DomStream = Stream & { _isDead?: boolean };
const domStreams = ref<DomStream[]>([]);

const customDef = computed(() => customLayouts.value.find((c) => c.id === streamLayout.value));

const streamsForWorkspace = (workspaceId: string) =>
  streams.value.filter((s) => workspaceIdOf(s.workspaceId) === workspaceId);

const { maximizedStreamId, restore: restoreMaximized } = useMaximizedStream();
const { setTileCovered } = useBrowserTiles();

const arrangedByWorkspace = computed(() => {
  const map: Record<string, ReturnType<typeof arrangeStreams>> = {};
  for (const ws of workspaces.value) {
    const list = streamsForWorkspace(ws.id);
    const arranged = customDef.value
      ? arrangeCustomStreams(customDef.value, list, focusedStreamId.value)
      : arrangeStreams(resolveLayout(streamLayout.value), list, focusedStreamId.value);
    const maxId = maximizedStreamId.value;
    const maximized = maxId ? arranged.placedById[maxId] : undefined;
    // Maximize: that tile spans every track above the others, whatever the layout says. The
    // others keep their cells (and keep playing) underneath; empty "+" slots are hidden.
    map[ws.id] =
      maxId && maximized
        ? {
            ...arranged,
            placedById: {
              ...arranged.placedById,
              [maxId]: {
                ...maximized,
                hidden: false,
                style: { gridColumn: "1 / -1", gridRow: "1 / -1", zIndex: "30" },
              },
            },
            emptySlots: 0,
            emptyPlacements: [],
          }
        : arranged;
  }
  return map;
});

// A removed stream cannot stay maximized.
watch(streams, (list) => {
  const id = maximizedStreamId.value;
  if (id && !list.some((stream) => stream.id === id)) restoreMaximized();
});

// Native tiles are drawn above the page, so CSS stacking cannot put the maximized tile over them:
// the tiles it covers are parked off-screen instead (they keep playing) until it is restored.
watch(
  [maximizedStreamId, streams],
  ([maxId, list]) => {
    const owner = maxId ? list.find((stream) => stream.id === maxId) : undefined;
    for (const stream of list) {
      const covered =
        !!owner &&
        stream.id !== owner.id &&
        workspaceIdOf(stream.workspaceId) === workspaceIdOf(owner.workspaceId);
      setTileCovered(stream.id, covered);
    }
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  for (const stream of streams.value) setTileCovered(stream.id, false);
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

const grid = ref<HTMLElement | null>(null);
const moves = new Map<HTMLElement, Animation>();
let layoutGeneration = 0;
onBeforeUnmount(() => {
  layoutGeneration++;
  moves.forEach((animation) => animation.cancel());
  moves.clear();
});

async function playFlipAnimation() {
  const generation = ++layoutGeneration;
  const elements = Array.from(grid.value?.querySelectorAll<HTMLElement>("[data-stream-id]") ?? []);
  const previous = new Map(elements.map((element) => [element, element.getBoundingClientRect()]));
  moves.forEach((animation) => animation.cancel());
  moves.clear();
  await nextTick();
  if (disposed || generation !== layoutGeneration) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const element of elements) {
    const before = previous.get(element);
    const after = element.getBoundingClientRect();
    if (
      reduced ||
      !before ||
      before.width < 2 ||
      before.height < 2 ||
      after.width < 2 ||
      after.height < 2
    )
      continue;
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    const sx = before.width / after.width;
    const sy = before.height / after.height;
    if (
      Math.abs(dx) < 0.5 &&
      Math.abs(dy) < 0.5 &&
      Math.abs(sx - 1) < 0.005 &&
      Math.abs(sy - 1) < 0.005
    )
      continue;
    const animation = element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: "0 0" },
        { transform: "none", transformOrigin: "0 0" },
      ],
      { duration: 300, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" }
    );
    moves.set(element, animation);
    void animation.finished
      .then(() => {
        if (moves.get(element) === animation) moves.delete(element);
      })
      .catch(() => {});
  }
  window.dispatchEvent(new CustomEvent("multistream-layout-motion", { detail: reduced ? 0 : 300 }));
}

watch([focusedStreamId, maximizedStreamId, arrangedByWorkspace], playFlipAnimation, {
  flush: "pre",
});

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

const slotOfStream = (id: string) => activeArranged.value.placedById[id]?.slotIndex;

const openAddDialog = (slot: number) => {
  pendingSlot.value = slot;
  window.dispatchEvent(new CustomEvent("multistream-show-dialog", { detail: "add-stream" }));
};
</script>

<template>
  <!-- Every workspace stays mounted so switching rooms never pauses playback.
       Inactive rooms keep their layout boxes (visibility:hidden) instead of
       display:none so players never consider themselves hidden. -->
  <div ref="grid" class="h-full overflow-hidden select-none relative">
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
        @mouseup="onMouseUp(stream.id, slotOfStream)"
      >
        <div
          v-if="isDragging || linkDragging"
          :data-native-overlay="linkDragging ? true : undefined"
          :class="[
            'absolute inset-0 z-40 transition-colors',
            overId === stream.id && draggingId !== stream.id
              ? 'bg-blue-500/15 outline-2 -outline-offset-4 outline-dashed outline-blue-500'
              : 'bg-transparent',
          ]"
        />

        <div
          :class="[
            'absolute z-50 opacity-0 group-hover/grid-item:opacity-100 transition-opacity cursor-grab p-1.5 rounded-md bg-black/60 border border-white/10 hover:bg-black/80 text-white/50 hover:text-white',
            'top-3 left-1/2 -translate-x-1/2',
            isDragging ? 'cursor-grabbing' : '',
          ]"
          @mousedown.stop.prevent="beginDragOnMove(stream.id, $event)"
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
          :class="[
            'min-h-0 min-w-0 rounded-sm border border-dashed transition-colors cursor-pointer flex items-center justify-center group/placeholder',
            isDragging && overSlot === slot.index
              ? 'border-[#5b8def] bg-[#3b82f6]/15'
              : 'border-[#3a3f4b] bg-white/[0.02] hover:bg-[#3b82f6]/10 hover:border-[#5b8def]',
          ]"
          :aria-label="t('layouts.addToSlot')"
          @dragover="onLinkDragOver"
          @drop.stop="onLinkDrop($event, undefined, slot.index)"
          @mouseenter="onSlotEnter(slot.index)"
          @mouseleave="onSlotLeave"
          @mouseup="onSlotMouseUp(slotOfStream)"
          @click="openAddDialog(slot.index)"
        >
          <Plus class="size-6 text-gray-600 group-hover/placeholder:text-white transition-colors" />
        </button>
      </template>
    </div>
  </div>
</template>
<style scoped>
/* Stream leave animation — two-phase: fade out in place, then remove from DOM */
.stream-leaving {
  opacity: 0;
  transform: scale(0.95);
  pointer-events: none;
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
</style>
