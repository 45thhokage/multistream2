<script setup lang="ts">
import { emitTo } from "@tauri-apps/api/event";
import { useEventListener } from "@vueuse/core";
import LayoutPicker from "./LayoutPicker.vue";
import ChannelPreview from "./ChannelPreview.vue";

const query = new URLSearchParams(location.search);
const kind = query.get("nativeOverlay");
let data: Record<string, string> = {};
try {
  data = JSON.parse(query.get("data") || "{}");
} catch {
  /* Empty preview on invalid input. */
}
const dismiss = () => {
  void emitTo("main", "ui-overlay-dismiss");
};
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape") dismiss();
});
useEventListener(window, "blur", dismiss);
</script>

<template>
  <div class="h-screen w-screen overflow-hidden bg-[#0f1115]">
    <LayoutPicker v-if="kind === 'layout'" panel-only @close="dismiss" />
    <ChannelPreview
      v-else-if="kind === 'preview'"
      class="h-full"
      :thumbnail="data.thumbnail"
      :title="data.title"
      :category="data.category"
    />
  </div>
</template>
