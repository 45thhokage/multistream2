<script setup lang="ts">
import { ref } from "vue";
import { Radio } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import LiveNowBrowser from "./LiveNowBrowser.vue";

const { t } = useI18n();
const open = ref(false);
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        class="h-8 shrink-0 gap-1.5 bg-[#1f2227] border-[#2a2d33] text-gray-200 hover:bg-[#2a2d33]"
        data-testid="live-now-btn"
      >
        <Radio class="size-3.5" aria-hidden="true" />{{ t("liveNow.title") }}
      </Button>
    </DialogTrigger>
    <DialogContent
      class="flex h-[min(800px,90dvh)] flex-col bg-[#14161a] border-[#2a2d33] sm:max-w-3xl lg:max-w-5xl"
      data-testid="live-now-panel"
    >
      <DialogHeader class="shrink-0 pr-8">
        <DialogTitle class="text-white">{{ t("liveNow.title") }}</DialogTitle>
        <DialogDescription>{{ t("liveNow.description") }}</DialogDescription>
      </DialogHeader>
      <LiveNowBrowser v-if="open" />
    </DialogContent>
  </Dialog>
</template>
