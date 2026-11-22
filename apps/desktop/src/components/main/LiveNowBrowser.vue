<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowLeft, X, Heart, Loader2, Plus, Radio, RefreshCw, Users } from "@lucide/vue";
import LiveNowTags from "./LiveNowTags.vue";
import type { DirectoryCategory } from "@/lib/liveDirectory";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLiveNow, LIVE_PLATFORMS, type LiveEntry } from "@/composables/useLiveNow";
import { useStreams } from "@/composables/useStreams";
import { useFavorites } from "@/composables/useFavorites";
import { useLiveStatus } from "@/composables/useLiveStatus";
import { useNetworkStatus } from "@/composables/useNetworkStatus";
import { parseStreamUrl } from "@/lib/platformParser";
import { resolveStream } from "@/lib/streamResolver";
import { PLATFORMS } from "@/config/platforms";
import { toast } from "@/composables/useToast";

const { t, locale } = useI18n();
const {
  query,
  platform,
  category,
  categoryName,
  categories,
  results,
  visibleResults,
  loadedQuery,
  loadedTags,
  availableTags,
  tags,
  categoryQuery,
  categoryCursor,
  categoryError,
  loadCategories,
  channelResults,
  searchFailed,
  pages,
  hasMore,
  loadMore,
  retry,
  submitSearch,
  saved,
  saveFilter,
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
const tagInput = ref("");
const browsingCategories = ref(false);
const showCategories = computed(() => platform.value === "twitch" && browsingCategories.value);
const browseCategories = () => {
  browsingCategories.value = true;
  if (categoryQuery.value) {
    categoryQuery.value = "";
    return;
  }
  if (!categories.value.length && !categoryLoading.value) void loadCategories();
};
const chooseCategory = (item: DirectoryCategory) => {
  categoryName.value = item.name;
  category.value = item.id;
  loadedQuery.value = "";
  loadedTags.value = [];
  browsingCategories.value = false;
};
const allTwitchStreams = () => {
  category.value = "";
  categoryName.value = "";
  loadedQuery.value = "";
  loadedTags.value = [];
  browsingCategories.value = false;
};
const onCategoryScroll = (event: Event) => {
  const element = event.currentTarget as HTMLElement;
  if (
    element.scrollHeight - element.scrollTop - element.clientHeight < 160 &&
    categoryCursor.value &&
    !categoryLoading.value &&
    !categoryError.value
  )
    void loadCategories(true);
};
watch(platform, () => {
  browsingCategories.value = false;
});
const cards = computed(() => [...visibleResults.value, ...channelResults.value]);
const sections = computed(() => [
  { label: t("liveNow.title"), entries: visibleResults.value },
  { label: t("liveNow.channelResults"), entries: channelResults.value },
]);
const loadedCount = computed(() =>
  Object.entries(pages)
    .filter(([id]) => platform.value === "all" || platform.value === id)
    .reduce((sum, [, page]) => sum + page.items.length, 0)
);
const addTag = () => {
  const values = tagInput.value
    .split(",")
    .map((tag) => tag.trim().slice(0, 100))
    .filter(Boolean);
  const unique = new Map(tags.value.map((tag) => [tag.toLowerCase(), tag]));
  for (const tag of values) if (!unique.has(tag.toLowerCase())) unique.set(tag.toLowerCase(), tag);
  tags.value = [...unique.values()].slice(0, 10);
  tagInput.value = "";
};
const submit = async () => {
  const parsed = parseStreamUrl(query.value);
  if (parsed && parsed.platform !== "custom") {
    const resolved = await resolveStream(parsed, getStatus);
    if (resolved)
      addStream(
        resolved.channel,
        resolved.platform,
        resolved.iframeUrl,
        resolved.displayName,
        resolved.handle
      );
    return;
  }
  submitSearch();
};
const adding = ref<string | null>(null);
const key = (stream: LiveEntry) =>
  `${stream.platform}:${stream.channel}:${stream.status || "live"}`;
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
const formatViewers = (count?: number) =>
  count == null
    ? t("liveNow.unknown")
    : new Intl.NumberFormat(locale.value, { notation: "compact", maximumFractionDigits: 1 }).format(
        count
      );
const refreshBrowser = () => (showCategories.value ? loadCategories() : refresh());
const refreshVisible = () => {
  if (!document.hidden && isOnline.value && !showCategories.value) void refresh();
};
onMounted(() => {
  refreshVisible();
  window.addEventListener("focus", refreshVisible);
  window.addEventListener("online", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
});
watch(isOnline, (online) => {
  if (online) refreshVisible();
});
const timer = setInterval(refreshVisible, 60000);
onScopeDispose(() => {
  clearInterval(timer);
  window.removeEventListener("focus", refreshVisible);
  window.removeEventListener("online", refreshVisible);
  document.removeEventListener("visibilitychange", refreshVisible);
});
</script>

<template>
  <div class="live-now-browser flex min-h-0 flex-1 flex-col gap-3" data-testid="live-now-browser">
    <div class="flex items-center gap-2">
      <Input
        v-model="query"
        :placeholder="t('liveNow.search')"
        :aria-label="t('liveNow.search')"
        data-testid="live-now-search"
        class="min-w-0 flex-1 bg-[#1f2227] border-[#2a2d33]"
        @keydown.enter.prevent="submit"
      />
      <Button
        variant="outline"
        size="icon"
        :aria-label="t('liveNow.refresh')"
        :disabled="!isOnline || isLoadingSuggestions || isLoadingMoreSuggestions"
        @click="refreshBrowser"
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
    </div>
    <div
      :class="
        showCategories
          ? 'flex min-h-0 flex-1 flex-col gap-3'
          : 'min-h-0 flex-1 space-y-3 overflow-y-auto pr-1'
      "
      data-testid="live-now-content"
    >
      <template v-if="platform === 'twitch'">
        <div class="flex flex-col gap-2">
          <Button
            v-if="showCategories"
            variant="outline"
            size="sm"
            class="self-start"
            data-testid="live-now-back-streams"
            @click="browsingCategories = false"
            ><ArrowLeft class="size-3.5" aria-hidden="true" />{{ t("liveNow.backStreams") }}</Button
          >
          <Button
            v-else-if="category"
            variant="outline"
            size="sm"
            class="self-start"
            data-testid="live-now-back-categories"
            @click="browseCategories"
            ><ArrowLeft class="size-3.5" aria-hidden="true" />{{
              t("liveNow.backCategories")
            }}</Button
          >
          <div class="flex flex-wrap items-center gap-2">
            <Button
              v-if="!showCategories && !category"
              variant="outline"
              size="sm"
              data-testid="live-now-browse-categories"
              @click="browseCategories"
              >{{ t("liveNow.browseCategories") }}</Button
            >
            <Button
              v-else
              variant="outline"
              size="sm"
              data-testid="live-now-clear-category"
              @click="allTwitchStreams"
              >{{ t("liveNow.allTwitchStreams") }}</Button
            >
            <Input
              v-if="!showCategories && !category"
              v-model="loadedQuery"
              :placeholder="t('liveNow.loadedSearch')"
              :aria-label="t('liveNow.loadedSearch')"
              class="min-w-24 flex-1 basis-24"
              data-testid="live-now-loaded-search"
            />
          </div>
          <div v-if="category && !showCategories" class="flex items-center gap-2">
            <h3
              v-if="category && !showCategories"
              class="min-w-0 max-w-1/2 shrink truncate text-sm font-semibold text-white"
              :title="categoryName"
            >
              {{
                categoryName ||
                categories.find((item) => item.id === category)?.name ||
                t("liveNow.category")
              }}
            </h3>
            <Input
              v-if="!showCategories"
              v-model="loadedQuery"
              :placeholder="t('liveNow.loadedSearch')"
              :aria-label="t('liveNow.loadedSearch')"
              class="min-w-24 flex-1 basis-24"
              data-testid="live-now-loaded-search"
            />
          </div>
        </div>
        <Input
          v-if="showCategories"
          v-model="categoryQuery"
          :placeholder="t('liveNow.twitchCategorySearch')"
          :aria-label="t('liveNow.twitchCategorySearch')"
          data-testid="live-now-category-search"
        />
        <template v-else>
          <div class="flex items-center gap-2">
            <Input
              v-model="tagInput"
              :placeholder="t('liveNow.twitchTagsPlaceholder')"
              :aria-label="t('liveNow.directoryTags')"
              class="min-w-0 flex-1"
              data-testid="live-now-directory-tag"
              @keydown.enter.prevent="addTag"
            />
            <Button
              variant="outline"
              size="sm"
              :disabled="!tagInput.trim()"
              data-testid="live-now-apply-tag"
              @click="addTag"
              >{{ t("liveNow.applyTag") }}</Button
            >
          </div>
          <div v-if="tags.length" class="flex flex-wrap gap-1.5">
            <button
              v-for="tag in tags"
              :key="tag"
              type="button"
              class="inline-flex min-h-8 items-center gap-1 rounded-md border border-gray-500 bg-[#2a2d33] px-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-white"
              :aria-label="t('liveNow.removeTag', { tag })"
              @click="tags = tags.filter((value) => value !== tag)"
            >
              {{ tag }}<X class="size-3" aria-hidden="true" />
            </button>
          </div>
          <LiveNowTags v-model:selected="loadedTags" :available="availableTags" />
          <Button
            variant="outline"
            size="sm"
            class="self-start"
            :disabled="!tags.length && !loadedTags.length"
            @click="saveFilter"
            >{{ t("liveNow.saveTags") }}</Button
          >
        </template>
      </template>
      <template v-else>
        <details v-if="platform === 'kick'" class="shrink-0 text-xs text-gray-400">
          <summary class="min-h-8 cursor-pointer">{{ t("liveNow.category") }}</summary>
          <div class="space-y-2">
            <Input
              v-model="categoryQuery"
              :placeholder="t('liveNow.categorySearch')"
              :aria-label="t('liveNow.categorySearch')"
              data-testid="live-now-category-search"
            />
            <div class="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              <Button
                v-for="item in categories"
                :key="item.id"
                variant="outline"
                size="sm"
                @click="chooseCategory(item)"
                >{{ item.name }}</Button
              >
            </div>
            <Button v-if="categoryError" variant="outline" size="sm" @click="loadCategories()">{{
              t("liveNow.retry")
            }}</Button>
            <Button variant="outline" size="sm" :disabled="!category" @click="saveFilter">{{
              t("liveNow.saveFilter")
            }}</Button>
          </div>
        </details>
        <Button
          v-if="category"
          variant="outline"
          size="sm"
          data-testid="live-now-clear-category"
          @click="
            category = '';
            categoryName = '';
          "
          >{{ t("liveNow.clearCategory") }}</Button
        >
        <Input
          v-model="loadedQuery"
          :placeholder="t('liveNow.loadedSearch')"
          :aria-label="t('liveNow.loadedSearch')"
          data-testid="live-now-loaded-search"
        />
        <LiveNowTags v-model:selected="loadedTags" :available="availableTags" />
      </template>
      <div v-if="!showCategories" class="flex flex-wrap gap-2" data-testid="live-now-saved-filters">
        <template v-for="(filter, index) in saved" :key="index">
          <div v-if="filter.provider === platform" class="inline-flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              @click="
                tags = [...filter.tags];
                loadedTags = [...(filter.loadedTags || [])];
                category = filter.category;
                categoryName = filter.provider === 'kick' ? filter.label : categoryName;
              "
              >{{ filter.label }}</Button
            >
            <Button
              variant="outline"
              size="icon"
              class="size-8"
              :aria-label="t('liveNow.deleteFilter')"
              @click="saved.splice(index, 1)"
              ><X class="size-3" aria-hidden="true"
            /></Button>
          </div>
        </template>
      </div>
      <p v-if="!showCategories" class="text-xs text-gray-400">
        {{ t("liveNow.loadedCount", { matching: results.length, loaded: loadedCount }) }}
      </p>
      <p v-if="!isOnline" class="text-sm text-gray-400" role="status">{{ t("liveNow.offline") }}</p>
      <div v-if="failed" role="alert" class="text-sm text-gray-400">
        <template v-for="(page, id) in pages" :key="id"
          ><p v-if="page.error" :title="page.errorMessage">
            {{ id }}: {{ t("liveNow.failed") }}
            <Button variant="outline" size="sm" :disabled="page.busy" @click="retry(id)">{{
              t("liveNow.retry")
            }}</Button>
          </p></template
        >
      </div>
      <p v-if="searchFailed" role="alert" class="text-xs text-gray-400">
        {{ t("liveNow.failed") }}
        <Button variant="outline" size="sm" @click="submitSearch">{{ t("liveNow.retry") }}</Button>
      </p>
      <div
        v-if="showCategories"
        class="min-h-0 flex-1 overflow-y-auto pr-1"
        data-testid="live-now-category-browser"
        :aria-busy="categoryLoading"
        @scroll="onCategoryScroll"
      >
        <p class="mb-3 text-xs text-gray-400">{{ t("liveNow.chooseCategory") }}</p>
        <div class="flex flex-col gap-1">
          <button
            v-for="item in categories"
            :key="item.id"
            type="button"
            class="flex min-h-20 w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-[#1f2227] focus-visible:ring-2 focus-visible:ring-white"
            :data-testid="`live-now-category-${item.id}`"
            @click="chooseCategory(item)"
          >
            <img
              v-if="item.artwork"
              :src="item.artwork"
              alt=""
              class="h-16 w-12 shrink-0 rounded object-cover"
              loading="lazy"
            />
            <div
              v-else
              class="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-[#1f2227]"
            >
              <Radio class="size-4 text-gray-500" aria-hidden="true" />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-white">{{ item.name }}</p>
              <p v-if="item.viewerCount != null" class="mt-1 text-xs text-gray-400">
                {{ t("liveNow.categoryViewers", { count: formatViewers(item.viewerCount) }) }}
              </p>
            </div>
          </button>
        </div>
        <p
          v-if="categoryLoading"
          role="status"
          class="flex items-center gap-2 py-3 text-xs text-gray-400"
        >
          <Loader2 class="size-4 animate-spin" aria-hidden="true" />{{ t("common.loading") }}
        </p>
        <p
          v-else-if="!categories.length && !categoryError"
          class="py-4 text-sm text-gray-400"
          role="status"
        >
          {{ t("liveNow.empty") }}
        </p>
        <Button
          v-if="categoryError"
          variant="outline"
          size="sm"
          @click="loadCategories(!!categoryCursor)"
          >{{ t("liveNow.retry") }}</Button
        >
        <Button
          v-else-if="categoryCursor"
          variant="outline"
          size="sm"
          class="my-3 w-full"
          :disabled="categoryLoading"
          data-testid="live-now-more-categories"
          @click="loadCategories(true)"
          >{{ t("liveNow.moreCategories") }}</Button
        >
      </div>
      <div v-else class="pr-1" :aria-busy="isLoadingSuggestions || searching || categoryLoading">
        <p
          v-if="isLoadingSuggestions || searching || categoryLoading"
          class="mb-3 flex items-center gap-2 text-sm text-gray-400"
          role="status"
        >
          <Loader2 class="size-4 animate-spin" aria-hidden="true" />{{ t("common.loading") }}
        </p>
        <p
          v-if="!cards.length && !isLoadingSuggestions && !searching && !categoryLoading"
          class="py-12 text-center text-sm text-gray-400"
          role="status"
        >
          {{ t("liveNow.empty") }}
        </p>
        <section v-for="section in sections" :key="section.label" class="mb-4">
          <h3 v-if="section.entries.length" class="mb-3 text-xs text-gray-400">
            {{ section.label }}
          </h3>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            <article
              v-for="stream in section.entries"
              :key="key(stream)"
              class="min-w-0"
              :data-testid="`live-now-result-${stream.platform}-${stream.channel}`"
            >
              <button
                type="button"
                class="relative mb-2 block aspect-video w-full overflow-hidden rounded-md bg-[#1f2227] focus-visible:ring-2 focus-visible:ring-white"
                :aria-label="
                  t('liveNow.openStream', { channel: stream.displayName || stream.channel })
                "
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
                  >{{
                    stream.status === "offline"
                      ? t("liveNow.channelOffline")
                      : stream.status === "unknown"
                        ? t("liveNow.unknown")
                        : t("nativePlayer.live")
                  }}</span
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
                  :aria-label="
                    t('liveNow.favorite', { channel: stream.displayName || stream.channel })
                  "
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
        </section>
        <Button
          v-if="hasMore"
          :disabled="isLoadingSuggestions"
          data-testid="live-now-load-more"
          variant="outline"
          class="mx-auto mt-5 flex"
          @click="loadMore"
          >{{ t("liveNow.more") }}</Button
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.live-now-browser :deep([data-slot="button"]),
.live-now-browser :deep([data-slot="input"]) {
  background: #1f2227;
  color: #e5e7eb;
  border-color: #2a2d33;
}
.live-now-browser :deep([data-slot="button"]:hover:not(:disabled)) {
  background: #2a2d33;
}
</style>
