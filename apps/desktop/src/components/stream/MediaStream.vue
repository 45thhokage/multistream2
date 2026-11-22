<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import Hls from "hls.js";
import type { MediaPlayerClass } from "dashjs";
import { useI18n } from "vue-i18n";
import { proxiedMediaUrl, type MediaKind } from "@/lib/mediaSource";

const props = defineProps<{
  channelid: string;
  url: string;
  kind: MediaKind;
}>();

const { t } = useI18n();

interface QualityOption {
  value: string;
  label: string;
}

const video = ref<HTMLVideoElement | null>(null);
const levels = ref<QualityOption[]>([]);
const preference = ref("max");
const error = ref<string | null>(null);
const stats = ref({ resolution: "", bitrate: "", dropped: 0, buffer: 0 });
const showStats = ref(false);

let hls: Hls | null = null;
let dash: MediaPlayerClass | null = null;
let retries = 0;
let mediaRecoveries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let generation = 0;

const source = computed(() => (props.kind === "file" ? props.url : proxiedMediaUrl(props.url)));

const qualityLabel = (height?: number, bitrate?: number, fps?: number): string => {
  const parts: string[] = [];
  if (height) parts.push(`${height}p${fps && fps > 30 ? Math.round(fps) : ""}`);
  if (bitrate) parts.push(`${(bitrate / 1e6).toFixed(1)} Mbps`);
  return parts.join(" · ") || t("media.source");
};

/** Highest resolution, then frame rate, then bitrate. */
function bestHlsLevel(list: Hls["levels"]): number {
  let best = -1;
  list.forEach((level, index) => {
    if (best < 0) {
      best = index;
      return;
    }
    const a = [level.height || 0, level.frameRate || 0, level.bitrate || 0];
    const current = list[best];
    const b = [current?.height || 0, current?.frameRate || 0, current?.bitrate || 0];
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) {
        if ((a[i] ?? 0) > (b[i] ?? 0)) best = index;
        break;
      }
    }
  });
  return best;
}

function applyPreference() {
  const choice = preference.value;
  if (hls && hls.levels.length) {
    if (choice === "auto") hls.currentLevel = -1;
    else if (choice === "max") hls.currentLevel = bestHlsLevel(hls.levels);
    else hls.currentLevel = Number(choice);
  }
  if (dash) {
    const auto = choice === "auto";
    dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: auto } } } });
    if (!auto) {
      const list = dash.getBitrateInfoListFor("video");
      if (list.length) {
        const index =
          choice === "max"
            ? list.reduce((top, item, i) => (item.bitrate > (list[top]?.bitrate ?? 0) ? i : top), 0)
            : Number(choice);
        dash.setQualityFor("video", index, true);
      }
    }
  }
}

function play() {
  const el = video.value;
  if (!el) return;
  el.play().catch(() => {
    // Browsers outside the desktop app may refuse unmuted autoplay.
    el.muted = true;
    el.play().catch(() => {});
  });
}

function destroy() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  hls?.destroy();
  hls = null;
  dash?.reset();
  dash = null;
  const el = video.value;
  if (el) {
    el.removeAttribute("src");
    el.load();
  }
}

function fail(message: string) {
  error.value = message;
}

function scheduleRetry(run: () => void) {
  if (retries >= 6) {
    fail(t("media.unreachable"));
    return;
  }
  retries++;
  retryTimer = setTimeout(run, Math.min(15000, 1000 * 2 ** retries) + Math.random() * 500);
}

function startHls(el: HTMLVideoElement) {
  if (!Hls.isSupported()) {
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = source.value;
      play();
      return;
    }
    fail(t("media.unsupported"));
    return;
  }
  const player = new Hls({
    lowLatencyMode: true,
    capLevelToPlayerSize: false,
    backBufferLength: 30,
    manifestLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 10000,
        maxLoadTimeMs: 20000,
        timeoutRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
        errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
      },
    },
  });
  hls = player;
  player.on(Hls.Events.MANIFEST_PARSED, () => {
    retries = 0;
    levels.value = player.levels
      .map((level, index) => ({ level, index }))
      .toSorted(
        (a, b) =>
          (b.level.height || 0) - (a.level.height || 0) ||
          (b.level.bitrate || 0) - (a.level.bitrate || 0)
      )
      .map(({ level, index }) => ({
        value: String(index),
        label: qualityLabel(level.height, level.bitrate, level.frameRate),
      }));
    applyPreference();
    play();
  });
  player.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 3) {
      mediaRecoveries++;
      if (mediaRecoveries === 2) player.swapAudioCodec();
      player.recoverMediaError();
      return;
    }
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      const gen = generation;
      scheduleRetry(() => {
        if (gen === generation && hls === player) player.startLoad();
      });
      return;
    }
    fail(t("media.playbackFailed", { detail: data.details }));
  });
  player.loadSource(source.value);
  player.attachMedia(el);
}

async function startDash(el: HTMLVideoElement) {
  const gen = generation;
  const dashjs = await import("dashjs");
  if (gen !== generation) return;
  const player = dashjs.MediaPlayer().create();
  dash = player;
  player.updateSettings({
    streaming: { abr: { autoSwitchBitrate: { video: preference.value === "auto" } } },
  });
  player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
    retries = 0;
    levels.value = player
      .getBitrateInfoListFor("video")
      .map((info, index) => ({ info, index }))
      .toSorted((a, b) => b.info.bitrate - a.info.bitrate)
      .map(({ info, index }) => ({
        value: String(index),
        label: qualityLabel(info.height, info.bitrate),
      }));
    applyPreference();
  });
  player.on(dashjs.MediaPlayer.events.ERROR, () => {
    const current = generation;
    scheduleRetry(() => {
      if (current === generation) void load();
    });
  });
  player.initialize(el, source.value, true);
}

async function load() {
  const el = video.value;
  if (!el) return;
  generation++;
  destroy();
  error.value = null;
  levels.value = [];
  mediaRecoveries = 0;
  if (props.kind === "file") {
    el.src = source.value;
    play();
    return;
  }
  if (props.kind === "hls") startHls(el);
  else await startDash(el);
}

function reload() {
  retries = 0;
  void load();
}

function updateStats() {
  const el = video.value;
  if (!el) return;
  const quality = el.getVideoPlaybackQuality?.();
  let bitrate = 0;
  if (hls && hls.currentLevel >= 0) bitrate = hls.levels[hls.currentLevel]?.bitrate ?? 0;
  else if (hls && hls.loadLevel >= 0) bitrate = hls.levels[hls.loadLevel]?.bitrate ?? 0;
  else if (dash) {
    const list = dash.getBitrateInfoListFor("video");
    bitrate = list[dash.getQualityFor("video")]?.bitrate ?? 0;
  }
  let buffer = 0;
  if (el.buffered.length)
    buffer = Math.max(0, el.buffered.end(el.buffered.length - 1) - el.currentTime);
  stats.value = {
    resolution: el.videoWidth ? `${el.videoWidth}×${el.videoHeight}` : "",
    bitrate: bitrate ? `${(bitrate / 1e6).toFixed(2)} Mbps` : "",
    dropped: quality?.droppedVideoFrames ?? 0,
    buffer: Math.round(buffer * 10) / 10,
  };
}

function onReloadEvent(event: Event) {
  const detail = (event as CustomEvent<{ channelid?: string }>).detail;
  if (detail?.channelid === props.channelid) reload();
}

watch(preference, applyPreference);
watch(() => [props.url, props.kind], reload);

onMounted(() => {
  void load();
  statsTimer = setInterval(updateStats, 1000);
  window.addEventListener("multistream-reload-stream", onReloadEvent);
});

onUnmounted(() => {
  generation++;
  destroy();
  if (statsTimer) clearInterval(statsTimer);
  window.removeEventListener("multistream-reload-stream", onReloadEvent);
});
</script>

<template>
  <div
    class="relative h-full w-full bg-black group/media"
    :data-testid="`media-stream-${channelid}`"
  >
    <video
      ref="video"
      class="block h-full w-full object-contain bg-black"
      controls
      playsinline
      autoplay
      :data-media-kind="kind"
    />
    <div
      class="absolute top-2 left-2 z-40 flex items-center gap-1.5 opacity-0 group-hover/media:opacity-100 transition-opacity"
    >
      <span
        class="px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-[10px] font-semibold uppercase tracking-wide text-indigo-300"
        >{{ kind === "file" ? $t("media.kindFile") : kind.toUpperCase() }}</span
      >
      <label v-if="levels.length > 0" class="sr-only" :for="`media-quality-${channelid}`">{{
        $t("media.quality")
      }}</label>
      <select
        v-if="levels.length > 0"
        :id="`media-quality-${channelid}`"
        v-model="preference"
        class="h-6 rounded bg-black/70 border border-white/15 text-[11px] text-white/90 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <option value="max">{{ $t("media.qualityMax") }}</option>
        <option value="auto">{{ $t("media.qualityAuto") }}</option>
        <option v-for="level in levels" :key="level.value" :value="level.value">
          {{ level.label }}
        </option>
      </select>
      <button
        type="button"
        class="h-6 px-1.5 rounded bg-black/60 border border-white/10 text-[10px] text-white/70 hover:text-white"
        :aria-pressed="showStats"
        @click="showStats = !showStats"
      >
        {{ $t("media.stats") }}
      </button>
    </div>
    <dl
      v-if="showStats"
      class="absolute top-10 left-2 z-40 grid grid-cols-[max-content_auto] gap-x-3 gap-y-0.5 rounded bg-black/75 border border-white/10 px-2 py-1.5 font-mono text-[10px] text-white/70"
    >
      <dt class="text-white/40">{{ $t("media.statResolution") }}</dt>
      <dd>{{ stats.resolution || "—" }}</dd>
      <dt class="text-white/40">{{ $t("media.statBitrate") }}</dt>
      <dd>{{ stats.bitrate || "—" }}</dd>
      <dt class="text-white/40">{{ $t("media.statBuffer") }}</dt>
      <dd>{{ stats.buffer }} s</dd>
      <dt class="text-white/40">{{ $t("media.statDropped") }}</dt>
      <dd>{{ stats.dropped }}</dd>
    </dl>
    <div
      v-if="error"
      role="alert"
      class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center"
    >
      <p class="text-sm text-white/80 max-w-sm">{{ error }}</p>
      <button
        type="button"
        class="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white"
        @click="reload"
      >
        {{ $t("media.retry") }}
      </button>
    </div>
  </div>
</template>
