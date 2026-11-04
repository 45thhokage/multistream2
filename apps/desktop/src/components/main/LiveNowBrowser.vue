<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Heart, Loader2, Plus, Radio, RefreshCw, Users } from "@lucide/vue";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLiveNow, LIVE_PLATFORMS, type LiveEntry } from "@/composables/useLiveNow";
import { useStreams } from "@/composables/useStreams";
import { useFavorites } from "@/composables/useFavorites";
import { useLiveStatus } from "@/composables/useLiveStatus";
import { useNetworkStatus } from "@/composables/useNetworkStatus";
import { resolveStream } from "@/lib/streamResolver";
import { PLATFORMS } from "@/config/platforms";
import { toast } from "@/composables/useToast";

const { t, locale } = useI18n();
const {
  query,
  platform,
  category,
  categories,
  results,
  visibleResults,
  visibleCount,
  searching,
  categoryLoading,
  failed,
  isLoadingSuggestions,
  isLoadingMoreSuggestions,
  refresh,
} = useLiveNow();
const { activeStreams, addStream } = useStreams();
const { favorites, addFavorite, removeFavorite } = useFavorites();
const { getStatus } = useLiveStatus();
const { isOnline } = useNetworkStatus();
const adding = ref<string | null>(null);
const key = (stream: LiveEntry) => `${stream.platform}:${stream.channel}`;
const isAdded = (stream: LiveEntry) =>
  activeStreams.value.some(
    (item) =>
      item.platform === stream.platform &&
      (item.channel.toLowerCase() === stream.channel.toLowerCase() ||
        (stream.resolveChannel &&
          item.handle?.replace(/^@+/, "").toLowerCase() ===
            (stream.handle || stream.channel).replace(/^@+/, "").toLowerCase()))
  );
const favoriteChannel = (stream: LiveEntry) => stream.handle || stream.channel;
const isFavorite = (stream: LiveEntry) =>
  favorites.value.some(
    (item) =>
      item.platform === stream.platform &&
      item.channel.replace(/^@+/, "").toLowerCase() ===
        favoriteChannel(stream).replace(/^@+/, "").toLowerCase()
  );
const toggleFavorite = (stream: LiveEntry) => {
  if (isFavorite(stream)) removeFavorite(favoriteChannel(stream), stream.platform);
  else addFavorite(favoriteChannel(stream), stream.platform, undefined, stream.displayName);
};
const openStream = async (stream: LiveEntry) => {
  if (adding.value) return;
  adding.value = key(stream);
  try {
    const resolved = stream.resolveChannel
      ? await resolveStream({ channel: stream.channel, platform: stream.platform }, getStatus)
      : stream;
    if (!resolved) {
      toast.error(t("toasts.youtube.offline"));
      return;
    }
    addStream(resolved.channel, resolved.platform, undefined, stream.displayName, stream.handle);
  } finally {
    adding.value = null;
  }
};
const formatViewers = (count: number) =>
  new Intl.NumberFormat(locale.value, { notation: "compact", maximumFractionDigits: 1 }).format(
    count
  );
onMounted(refresh);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4" data-testid="live-now-browser">
    <div class="flex items-center gap-2">
      <Input
        v-model="query"
        :placeholder="t('liveNow.search')"
        :aria-label="t('liveNow.search')"
        data-testid="live-now-search"
        class="min-w-0 flex-1 bg-[#1f2227] border-[#2a2d33]"
      />
      <Button
        variant="outline"
        size="icon"
        :aria-label="t('common.refresh')"
        :disabled="!isOnline || isLoadingSuggestions || isLoadingMoreSuggestions"
        @click="refresh"
      >
        <RefreshCw
          class="size-4"
          :class="isLoadingSuggestions || isLoadingMoreSuggestions ? 'animate-spin' : ''"
          aria-hidden="true"
        />
      </Button>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex flex-wrap gap-1" :aria-label="t('liveNow.platforms')">
        <button
          type="button"
          class="min-h-8 rounded-md px-3 text-xs transition-colors hover:bg-[#2a2d33] focus-visible:ring-2 focus-visible:ring-white"
          :class="platform === 'all' ? 'bg-[#2a2d33] text-white' : 'text-gray-400'"
          :aria-pressed="platform === 'all'"
          @click="platform = 'all'"
        >
          {{ t("sidebar.all") }}
        </button>
        <button
          v-for="id in LIVE_PLATFORMS"
          :key="id"
          type="button"
          class="min-h-8 flex items-center gap-1.5 rounded-md px-3 text-xs transition-colors hover:bg-[#2a2d33] focus-visible:ring-2 focus-visible:ring-white"
          :class="platform === id ? 'bg-[#2a2d33] text-white' : 'text-gray-400'"
          :aria-pressed="platform === id"
          :data-testid="`live-now-platform-${id}`"
          @click="platform = id"
        >
          <component :is="PLATFORMS[id].icon" class="size-3.5" aria-hidden="true" />{{
            PLATFORMS[id].name
          }}
        </button>
      </div>
      <select
        v-model="category"
        class="min-h-8 max-w-full rounded-md border border-[#2a2d33] bg-[#1f2227] px-2 text-xs text-gray-200 focus-visible:ring-2 focus-visible:ring-white"
        :aria-label="t('liveNow.category')"
        data-testid="live-now-category"
      >
        <option value="">{{ t("liveNow.allCategories") }}</option>
        <option v-for="name in categories" :key="name" :value="name">{{ name }}</option>
      </select>
    </div>
    <p v-if="!isOnline" class="text-sm text-gray-400" role="status">{{ t("liveNow.offline") }}</p>
    <p v-else-if="failed" class="text-sm text-gray-400" role="alert">{{ t("liveNow.failed") }}</p>
    <div
      class="min-h-0 flex-1 overflow-y-auto pr-1"
      :aria-busy="isLoadingSuggestions || searching || categoryLoading"
    >
      <p
        v-if="isLoadingSuggestions || searching || categoryLoading"
        class="mb-3 flex items-center gap-2 text-sm text-gray-400"
        role="status"
      >
        <Loader2 class="size-4 animate-spin" aria-hidden="true" />{{ t("common.loading") }}
      </p>
      <p
        v-if="!visibleResults.length && !isLoadingSuggestions && !searching && !categoryLoading"
        class="py-12 text-center text-sm text-gray-400"
        role="status"
      >
        {{ t("liveNow.empty") }}
      </p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="stream in visibleResults"
          :key="key(stream)"
          class="min-w-0"
          :data-testid="`live-now-result-${stream.platform}-${stream.channel}`"
        >
          <button
            type="button"
            class="relative mb-2 block aspect-video w-full overflow-hidden rounded-md bg-[#1f2227] focus-visible:ring-2 focus-visible:ring-white"
            :aria-label="t('liveNow.openStream', { channel: stream.displayName || stream.channel })"
            :disabled="isAdded(stream) || adding !== null"
            @click="openStream(stream)"
          >
            <img
              v-if="stream.thumbnail"
              :src="stream.thumbnail"
              alt=""
              loading="lazy"
              class="size-full object-cover"
              @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
            />
            <Radio
              v-else
              class="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-gray-500"
              aria-hidden="true"
            />
            <span
              class="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/80 px-1.5 py-1 text-xs text-white"
              ><Users class="size-3" aria-hidden="true" />{{
                formatViewers(stream.viewerCount)
              }}</span
            >
            <span
              class="absolute top-2 left-2 rounded bg-black/80 px-1.5 py-1 text-xs text-white"
              >{{ t("nativePlayer.live") }}</span
            >
          </button>
          <div class="flex items-start gap-2">
            <component
              :is="PLATFORMS[stream.platform].icon"
              class="mt-1 size-4 shrink-0 text-gray-400"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <p
                class="truncate text-sm font-medium text-white"
                :title="stream.displayName || stream.channel"
              >
                {{ stream.displayName || stream.channel }}
              </p>
              <p class="line-clamp-2 text-xs text-gray-400" :title="stream.title">
                {{ stream.title || stream.category }}
              </p>
              <p v-if="stream.category" class="mt-1 truncate text-xs text-gray-400">
                {{ stream.category }}
              </p>
            </div>
            <button
              type="button"
              class="min-h-8 min-w-8 rounded-md text-gray-400 hover:bg-[#1f2227] hover:text-white focus-visible:ring-2 focus-visible:ring-white"
              :aria-label="t('liveNow.favorite', { channel: stream.displayName || stream.channel })"
              :aria-pressed="isFavorite(stream)"
              @click="toggleFavorite(stream)"
            >
              <Heart
                class="mx-auto size-4"
                :class="isFavorite(stream) ? 'fill-current text-white' : ''"
                aria-hidden="true"
              />
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="mt-2 w-full"
            :disabled="isAdded(stream) || adding !== null"
            :data-testid="`live-now-add-${stream.platform}-${stream.channel}`"
            @click="openStream(stream)"
          >
            <Loader2
              v-if="adding === key(stream)"
              class="size-3.5 animate-spin"
              aria-hidden="true"
            /><Plus v-else-if="!isAdded(stream)" class="size-3.5" aria-hidden="true" />{{
              isAdded(stream) ? t("liveNow.added") : t("liveNow.add")
            }}
          </Button>
        </article>
      </div>
      <Button
        v-if="results.length > visibleCount"
        variant="outline"
        class="mx-auto mt-5 flex"
        @click="visibleCount += 24"
        >{{ t("liveNow.more") }}</Button
      >
    </div>
  </div>
</template>
