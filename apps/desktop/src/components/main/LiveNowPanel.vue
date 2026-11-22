<script setup lang="ts">
import { onKeyStroke } from "@vueuse/core";
import { X } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { useLiveNowPanel } from "@/composables/useLiveNowPanel";
import LiveNowBrowser from "./LiveNowBrowser.vue";

const { t } = useI18n();
const { open, close } = useLiveNowPanel();
onKeyStroke("Escape", () => {
  if (open.value) close();
});
</script>

<template>
  <aside
    v-if="open"
    id="live-now-panel"
    class="flex h-full w-[min(440px,45%)] min-w-[300px] shrink-0 flex-col gap-3 border-l border-[#2a2d33] bg-[#14161a] p-4"
    data-testid="live-now-panel"
    :aria-label="t('liveNow.title')"
  >
    <header class="flex shrink-0 items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-white">{{ t("liveNow.title") }}</h2>
        <p class="text-xs text-gray-400">{{ t("liveNow.description") }}</p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
        data-testid="live-now-close"
        @click="close"
      >
        <X class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ t("common.close") }}</span>
      </button>
    </header>
    <LiveNowBrowser />
  </aside>
</template>
