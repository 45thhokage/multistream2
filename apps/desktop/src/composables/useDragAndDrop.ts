import { ref, computed } from "vue";
import { createSharedComposable } from "@vueuse/core";
import { useStreams, type Stream } from "./useStreams";
import { useFocusedStream } from "./useFocusedStream";

const DRAG_THRESHOLD_PX = 4;

const _useDragAndDrop = () => {
  const draggingId = ref<string | null>(null);
  const overId = ref<string | null>(null);
  const overSlot = ref<number | null>(null);

  const { streams } = useStreams();
  const { focusedStreamId } = useFocusedStream();

  const isDragging = computed(() => draggingId.value !== null);

  type SlotOf = (id: string) => number | undefined;

  const swapStreams = (targetId: string, slotOf?: SlotOf) => {
    if (draggingId.value === null || draggingId.value === targetId) return;

    const fromIndex = streams.value.findIndex((s) => s.id === draggingId.value);
    const toIndex = streams.value.findIndex((s) => s.id === targetId);

    if (fromIndex === -1 || toIndex === -1) return;

    const draggedStream = streams.value[fromIndex] as Stream;
    const targetStream = streams.value[toIndex] as Stream;

    const next = [...streams.value];
    next[fromIndex] = targetStream;
    next[toIndex] = draggedStream;
    // Pinned tiles keep their slot, so swap the slots the two tiles actually occupy.
    const draggedSlot = slotOf?.(draggedStream.id);
    const targetSlot = slotOf?.(targetStream.id);
    if (
      draggedSlot !== undefined &&
      targetSlot !== undefined &&
      draggedSlot >= 0 &&
      targetSlot >= 0
    ) {
      next[fromIndex] = { ...targetStream, slot: draggedSlot };
      next[toIndex] = { ...draggedStream, slot: targetSlot };
    }
    streams.value = next;

    if (focusedStreamId.value === draggedStream.id) {
      focusedStreamId.value = targetStream.id;
    } else if (focusedStreamId.value === targetStream.id) {
      focusedStreamId.value = draggedStream.id;
    }
  };

  // Dropping on an empty tile pins the dragged stream to that tile. Unpinned tiles fill the lowest
  // free slots, so the tile the dragged stream leaves would otherwise be refilled by the streams
  // after it, shifting them; every other placed tile is pinned where it currently is instead.
  const moveToSlot = (slot: number, slotOf?: SlotOf) => {
    if (draggingId.value === null) return;
    const dragged = streams.value.find((s) => s.id === draggingId.value);
    if (!dragged) return;
    const others = streams.value
      .filter((s) => s.id !== dragged.id)
      .map((s) => {
        const current = slotOf?.(s.id);
        return current !== undefined && current >= 0 && current !== s.slot
          ? Object.assign({}, s, { slot: current })
          : s;
      });
    streams.value = [...others, { ...dragged, slot }];
  };

  const onMouseDown = (id: string) => {
    draggingId.value = id;
  };

  // A press on a grip only becomes a drag once the pointer really moves, so a plain
  // click never hides the players.
  const beginDragOnMove = (id: string, event: MouseEvent) => {
    const startX = event.clientX;
    const startY = event.clientY;
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    function move(next: MouseEvent) {
      // The release can happen where the page never sees it (over a native stream tile or
      // outside the window). Without the button held this is no longer the same press.
      if (typeof next.buttons === "number" && (next.buttons & 1) === 0) {
        stop();
        return;
      }
      if (Math.hypot(next.clientX - startX, next.clientY - startY) < DRAG_THRESHOLD_PX) return;
      stop();
      onMouseDown(id);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  const onMouseEnter = (id: string) => {
    if (draggingId.value === null) return;
    overId.value = id;
    overSlot.value = null;
  };

  const onMouseLeave = () => {
    if (draggingId.value === null) return;
    overId.value = null;
  };

  const onSlotEnter = (index: number) => {
    if (draggingId.value === null) return;
    overSlot.value = index;
    overId.value = null;
  };

  const onSlotLeave = () => {
    if (draggingId.value === null) return;
    overSlot.value = null;
  };

  const cancelDrag = () => {
    draggingId.value = null;
    overId.value = null;
    overSlot.value = null;
  };

  const onMouseUp = (targetId: string, slotOf?: SlotOf) => {
    if (draggingId.value !== null && overId.value !== null) {
      swapStreams(targetId, slotOf);
    }
    cancelDrag();
  };

  const onSlotMouseUp = (slotOf?: SlotOf) => {
    if (overSlot.value !== null) moveToSlot(overSlot.value, slotOf);
    cancelDrag();
  };

  const onGlobalMouseUp = cancelDrag;

  return {
    draggingId,
    overId,
    overSlot,
    beginDragOnMove,
    onSlotEnter,
    onSlotLeave,
    onSlotMouseUp,
    cancelDrag,
    isDragging,
    onMouseDown,
    onMouseEnter,
    onMouseLeave,
    onMouseUp,
    onGlobalMouseUp,
  };
};

export const useDragAndDrop = createSharedComposable(_useDragAndDrop);
