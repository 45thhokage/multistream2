<script setup lang="ts">
import { Volume2 } from "@lucide/vue";
import { useStreamMixer, AUDIO_MODES, type AudioMode } from "@/composables/useStreamMixer";
import { nativeOutputAvailable } from "@/lib/nativePlayer";

const { workspace } = useStreamMixer();
const available = nativeOutputAvailable();
const change = (event: Event) => {
  workspace().mode = (event.target as HTMLSelectElement).value as AudioMode;
};
</script>

<template>
  <label
    class="flex items-center h-8 gap-1 rounded-lg border border-[#2a2d33] bg-[#1e2127] px-2 text-gray-200 focus-within:ring-2 focus-within:ring-white/40"
  >
    <Volume2 class="size-4 shrink-0" aria-hidden="true" />
    <select
      :value="workspace().mode ?? 'multi'"
      :disabled="!available"
      :aria-label="$t('mixer.audioMode')"
      data-testid="audio-mode-picker"
      class="min-w-0 max-w-44 h-full bg-[#1e2127] text-xs cursor-pointer disabled:opacity-50 focus:outline-none"
      @change="change"
    >
      <option v-for="mode in AUDIO_MODES" :key="mode" :value="mode">
        {{ $t(`mixer.modes.${mode}`) }}
      </option>
    </select>
  </label>
</template>
