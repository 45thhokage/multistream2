<script setup lang="ts">
import { computed } from "vue";
import { Check, X } from "@lucide/vue";
import { useI18n } from "vue-i18n";
const props = defineProps<{ available: string[]; selected: string[] }>();
const emit = defineEmits<{ "update:selected": [tags: string[]] }>();
const { t } = useI18n();
const choices = computed(() => [...new Set([...props.selected, ...props.available])]);
const toggle = (tag: string) =>
  emit(
    "update:selected",
    props.selected.includes(tag)
      ? props.selected.filter((value) => value !== tag)
      : [...props.selected, tag]
  );
</script>

<template>
  <div v-if="available.length || selected.length" class="space-y-2">
    <div class="flex items-center justify-between gap-2 text-xs text-gray-400">
      <span>{{ t("liveNow.loadedTags") }}</span>
      <button
        v-if="selected.length"
        type="button"
        class="min-h-8 rounded px-2 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
        @click="emit('update:selected', [])"
      >
        {{ t("liveNow.clearTags") }}
      </button>
    </div>
    <div
      class="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1"
      role="group"
      :aria-label="t('liveNow.loadedTags')"
      data-testid="live-now-loaded-tags"
    >
      <button
        v-for="tag in choices"
        :key="tag"
        type="button"
        class="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-white"
        :class="
          selected.includes(tag)
            ? 'border-gray-500 bg-[#2a2d33] text-white'
            : 'border-[#2a2d33] bg-[#1f2227] text-gray-300 hover:border-gray-500 hover:text-white'
        "
        :aria-pressed="selected.includes(tag)"
        @click="toggle(tag)"
      >
        <Check v-if="selected.includes(tag)" class="size-3 shrink-0" aria-hidden="true" />
        <span class="truncate" :title="tag">{{ tag }}</span>
        <X v-if="selected.includes(tag)" class="size-3 shrink-0" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
