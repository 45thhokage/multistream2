<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ thumbnail?: string; title?: string; category?: string }>();
const failed = ref(false);
watch(
  () => props.thumbnail,
  () => {
    failed.value = false;
  }
);
</script>

<template>
  <div
    class="overflow-hidden rounded-lg border border-[#2a2d33] bg-[#0f1115] text-gray-200"
    data-testid="channel-preview"
  >
    <img
      v-if="thumbnail && !failed"
      :src="thumbnail"
      alt=""
      referrerpolicy="no-referrer"
      class="w-full aspect-video object-cover"
      @error="failed = true"
    />
    <div
      v-else
      class="flex aspect-video items-center justify-center bg-[#14161a] text-xs text-gray-400"
    >
      {{ $t("sidebar.previewUnavailable") }}
    </div>
    <div class="p-2">
      <h4 class="text-sm font-medium text-white line-clamp-1">{{ title }}</h4>
      <p class="text-xs text-gray-400 mt-0.5 truncate">{{ category }}</p>
    </div>
  </div>
</template>
