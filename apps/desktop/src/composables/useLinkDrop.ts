import { ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { useStreams } from "./useStreams";
import { droppedStreamUrl } from "@/lib/droppedStreamUrl";

export function useLinkDrop() {
  const { streams, addStream, removeStream } = useStreams();
  const linkDragging = ref(false);
  useEventListener(window, "dragenter", (event: DragEvent) => {
    linkDragging.value = !!event.dataTransfer?.types.some(
      (type) => type === "text/uri-list" || type === "text/plain"
    );
  });
  useEventListener(window, "dragend", () => {
    linkDragging.value = false;
  });
  useEventListener(window, "drop", () => {
    linkDragging.value = false;
  });
  useEventListener(window, "dragleave", (event: DragEvent) => {
    if (!event.relatedTarget) linkDragging.value = false;
  });
  const onLinkDragOver = (event: DragEvent) => {
    if (
      !event.dataTransfer?.types.some((type) => type === "text/uri-list" || type === "text/plain")
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onLinkDrop = (event: DragEvent, targetId?: string) => {
    event.preventDefault();
    linkDragging.value = false;
    if (!event.dataTransfer) return;
    const parsed = droppedStreamUrl(event.dataTransfer);
    if (!parsed) return;
    const targetIndex = streams.value.findIndex((stream) => stream.id === targetId);
    const target = streams.value[targetIndex];
    // Validate duplicates and capacity before removing the existing player.
    const newId = addStream(
      parsed.channel,
      parsed.platform,
      parsed.iframeUrl,
      undefined,
      undefined,
      target?.id
    );
    if (!newId || !target) return;
    removeStream(target.id);
    const next = [...streams.value];
    const addedIndex = next.findIndex((stream) => stream.id === newId);
    const added = next.splice(addedIndex, 1)[0];
    if (added) next.splice(targetIndex, 0, added);
    streams.value = next;
  };
  return { onLinkDrop, onLinkDragOver, linkDragging };
}
