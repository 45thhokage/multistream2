<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef } from "vue";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { useEventListener } from "@vueuse/core";
import LayoutPicker from "./LayoutPicker.vue";
import ChannelPreview from "./ChannelPreview.vue";

interface OverlayContent {
  generation: number;
  kind: "layout" | "preview";
  data: Record<string, string>;
}

const THUMBNAIL_WAIT_MS = 600;
const content = shallowRef<OverlayContent | null>(null);
let active = false;

const dismiss = () => {
  void emitTo("main", "ui-overlay-dismiss");
};

const preload = (src: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = image.onerror = () => resolve();
    image.src = src;
  });

async function render(next: OverlayContent) {
  active = true;
  content.value = next;
  await nextTick();
  if (next.data.thumbnail) {
    await Promise.race([
      preload(next.data.thumbnail),
      new Promise((resolve) => setTimeout(resolve, THUMBNAIL_WAIT_MS)),
    ]);
  }
  // No requestAnimationFrame here: this page is hidden until Rust shows it, and hidden pages get no frames.
  if (content.value?.generation === next.generation)
    void emit("ui-overlay-rendered", { generation: next.generation });
}

const unlisten = Promise.all([
  listen<OverlayContent>("ui-overlay-content", (event) => void render(event.payload)),
  listen("ui-overlay-reset", () => {
    active = false;
  }),
]).then((cleanups) => {
  void emit("ui-overlay-ready");
  return cleanups;
});
onBeforeUnmount(() => {
  void unlisten.then((cleanups) => cleanups.forEach((cleanup) => cleanup()));
});

useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape" && active) dismiss();
});
useEventListener(window, "blur", () => {
  if (active) dismiss();
});
</script>

<template>
  <div class="h-screen w-screen overflow-hidden bg-[#0f1115]">
    <template v-if="content">
      <LayoutPicker
        v-if="content.kind === 'layout'"
        :key="content.generation"
        panel-only
        @close="dismiss"
      />
      <ChannelPreview
        v-else
        :key="content.generation"
        class="h-full"
        :thumbnail="content.data.thumbnail"
        :title="content.data.title"
        :category="content.data.category"
      />
    </template>
  </div>
</template>
