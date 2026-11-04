<script setup lang="ts">
import { computed } from "vue";
import { nativeOutputAvailable } from "@/lib/nativePlayer";
import { useI18n } from "vue-i18n";
import { Volume2, VolumeX, X } from "@lucide/vue";
import { Slider } from "@/components/ui/slider";
import { useStreams } from "@/composables/useStreams";
import { useStreamMixer } from "@/composables/useStreamMixer";
import { useStreamQuality } from "@/composables/useStreamQuality";
import { useWorkspaces } from "@/composables/useWorkspaces";
import { PLATFORMS } from "@/config/platforms";

const { t } = useI18n();
const outputAvailable = nativeOutputAvailable();
const { activeStreams, removeStream } = useStreams();
const { activeWorkspaceId } = useWorkspaces();
const { workspace, channel, effectiveAudio, focusAudio } = useStreamMixer();
const { reports, preferences, setQuality } = useStreamQuality();
const ids = computed(() => activeStreams.value.map((stream) => stream.id));
const focused = computed(() =>
  ids.value.includes(workspace().focusedId || "") ? workspace().focusedId : ids.value[0]
);
const audio = (id: string) => effectiveAudio(id, activeWorkspaceId.value, ids.value);
const percent = (id: string) => (audio(id).muted ? 0 : Math.round(audio(id).volume * 100));
const quality = (id: string) => reports.value[id]?.current || preferences.value[id] || "auto";
const changeQuality = (id: string, event: Event) => {
  void setQuality(id, (event.target as HTMLSelectElement).value);
};
</script>

<template>
  <section
    class="shrink-0 max-h-[45%] overflow-y-auto border-b border-[#2a2d33] p-2 space-y-2 text-gray-400"
    :aria-label="t('mixer.title')"
    data-testid="stream-mixer"
  >
    <h2 class="text-xs font-semibold text-white px-1">{{ t("mixer.title") }}</h2>
    <p v-if="!outputAvailable" class="text-xs px-1" data-testid="mixer-native-required">
      {{ t("mixer.nativeRequired") }}
    </p>
    <div class="px-1 pb-2 space-y-1">
      <div class="flex items-center gap-2 text-xs">
        <span class="flex-1">{{ t("mixer.master") }}</span>
        <span class="tabular-nums">{{ workspace().muted ? 0 : workspace().volume }}%</span>
        <button
          type="button"
          :disabled="!outputAvailable"
          class="min-h-8 min-w-8 rounded hover:bg-[#1f2227] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-white"
          :aria-label="t('mixer.muteAll')"
          :aria-pressed="workspace().muted"
          @click="workspace().muted = !workspace().muted"
        >
          <component
            :is="workspace().muted ? VolumeX : Volume2"
            class="size-4 mx-auto"
            aria-hidden="true"
          />
        </button>
      </div>
      <Slider
        :disabled="!outputAvailable"
        :model-value="[workspace().volume]"
        :max="100"
        :step="1"
        :aria-label="t('mixer.master')"
        @update:model-value="workspace().volume = $event?.[0] ?? 100"
      />
    </div>
    <p v-if="!activeStreams.length" class="text-xs px-1">{{ t("mixer.empty") }}</p>
    <div
      v-for="stream in activeStreams"
      :key="stream.id"
      class="rounded-lg border bg-[#181a1f] p-2 space-y-1"
      :class="focused === stream.id ? 'border-blue-500' : 'border-[#2a2d33]'"
      :data-testid="`mixer-channel-${stream.channel}`"
    >
      <div class="flex items-center gap-1 text-xs">
        <span
          class="size-2 shrink-0 rounded-full"
          :style="{ backgroundColor: PLATFORMS[stream.platform].color }"
          aria-hidden="true"
        />
        <span
          class="truncate flex-1 font-semibold text-gray-200"
          :title="stream.displayName || stream.channel"
          >{{ stream.displayName || stream.handle || stream.channel }}</span
        >
        <button
          type="button"
          :disabled="!outputAvailable"
          class="min-h-8 min-w-8 rounded hover:bg-[#1f2227] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-white"
          :aria-label="t(channel(stream.id).muted ? 'mixer.unmute' : 'mixer.mute')"
          :aria-pressed="channel(stream.id).muted"
          @click="channel(stream.id).muted = !channel(stream.id).muted"
        >
          <component
            :is="channel(stream.id).muted ? VolumeX : Volume2"
            class="size-4 mx-auto"
            :class="audio(stream.id).muted ? 'text-gray-500' : 'text-gray-200'"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="min-h-8 min-w-8 rounded hover:bg-[#1f2227] hover:text-white focus-visible:ring-2 focus-visible:ring-white"
          :aria-label="t('mixer.closeStream', { channel: stream.displayName || stream.channel })"
          @click="removeStream(stream.id)"
        >
          <X class="size-3.5 mx-auto" aria-hidden="true" />
        </button>
      </div>
      <div class="flex items-center gap-2 min-h-6">
        <Volume2 class="size-3 shrink-0" aria-hidden="true" />
        <Slider
          :disabled="!outputAvailable"
          class="min-w-0 flex-1 [&_[data-slot=slider-range]]:bg-blue-500 [&_[data-slot=slider-thumb]]:bg-blue-500 [&_[data-slot=slider-thumb]]:border-blue-500"
          :model-value="[channel(stream.id).volume]"
          :max="100"
          :step="1"
          :aria-label="t('mixer.channelVolume', { channel: stream.displayName || stream.channel })"
          @update:model-value="channel(stream.id).volume = $event?.[0] ?? 100"
        />
        <span class="w-8 text-right text-xs tabular-nums">{{ percent(stream.id) }}%</span>
      </div>
      <div class="flex items-center gap-1">
        <select
          :value="quality(stream.id)"
          :disabled="!outputAvailable || !reports[stream.id]?.options.length"
          :aria-label="t('mixer.qualityFor', { channel: stream.displayName || stream.channel })"
          :title="
            reports[stream.id]?.options.length ? t('mixer.quality') : t('mixer.qualityUnavailable')
          "
          class="min-w-0 flex-1 h-8 rounded border border-[#2a2d33] bg-[#14161a] px-1 text-xs text-gray-200 disabled:text-gray-500 focus-visible:ring-2 focus-visible:ring-white"
          @change="changeQuality(stream.id, $event)"
        >
          <option v-if="!reports[stream.id]?.options.length" value="auto">
            {{ t("nativePlayer.quality.auto") }}
          </option>
          <option
            v-for="option in reports[stream.id]?.options || []"
            :key="option.id"
            :value="option.id"
          >
            {{ option.id === "auto" ? t("nativePlayer.quality.auto") : option.label }}
          </option>
        </select>
        <button
          type="button"
          :disabled="!outputAvailable"
          class="min-h-8 px-1 rounded text-xs hover:bg-[#1f2227] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-white"
          :class="channel(stream.id).solo ? 'text-white bg-white/10' : ''"
          :aria-pressed="channel(stream.id).solo"
          @click="channel(stream.id).solo = !channel(stream.id).solo"
        >
          {{ t("mixer.solo") }}
        </button>
        <button
          type="button"
          :disabled="!outputAvailable"
          class="min-h-8 px-1 rounded text-xs hover:bg-[#1f2227] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-white"
          :aria-pressed="focused === stream.id"
          @click="focusAudio(stream.id)"
        >
          {{ t("mixer.focus") }}
        </button>
      </div>
    </div>
  </section>
</template>
