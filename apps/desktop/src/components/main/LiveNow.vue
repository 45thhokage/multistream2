<script setup lang="ts">
import { Radio } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { useLiveNowPanel } from "@/composables/useLiveNowPanel";

const { t } = useI18n();
const { open, toggle } = useLiveNowPanel();
</script>

<template>
  <Button
    variant="outline"
    size="sm"
    class="h-8 shrink-0 gap-1.5 bg-[#1f2227] border-[#2a2d33] text-gray-200 hover:bg-[#2a2d33]"
    :class="open ? 'bg-[#2a2d33]' : ''"
    :aria-expanded="open"
    aria-controls="live-now-panel"
    data-testid="live-now-btn"
    @click="toggle"
  >
    <Radio class="size-3.5" aria-hidden="true" />{{ t("liveNow.title") }}
  </Button>
</template>
