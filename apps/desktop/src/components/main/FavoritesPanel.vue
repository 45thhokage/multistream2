<script setup lang="ts">
/**
 * The sidebar's Favorites list, arranged so a channel can be found in a long list (adapted from
 * Multi Worldview's FavoritesSection, MIT): Pinned, Live now and Others, a search box, and a chip
 * per site. The rules live in lib/favoriteView.ts.
 */
import { computed, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { ChevronRight, Heart, Pin, Search, X } from "@lucide/vue";
import TwitchIcon from "@/components/icons/TwitchIcon.vue";
import KickIcon from "@/components/icons/KickIcon.vue";
import YoutubeIcon from "@/components/icons/YoutubeIcon.vue";
import CustomIcon from "@/components/icons/CustomIcon.vue";
import { useFavorites, type FavoriteChannel } from "@/composables/useFavorites";
import { useFavoritesLive } from "@/composables/useFavoritesLive";
import { useFavoriteMenu } from "@/composables/useFavoriteMenu";
import { useOpenFavorite } from "@/composables/useOpenFavorite";
import {
  favoriteView,
  type FavoriteFilter,
  type FavoriteSectionId,
  type FavoriteViewRow,
} from "@/lib/favoriteView";
import { siteFaviconForUrl } from "@/lib/siteMeta";

/** Below this many favorites the whole list fits at a glance: no search box. */
const SEARCH_FROM = 8;
/** Rows of "Others" shown at first, and how many more each "Show more" reveals. */
const INITIAL = 25;
const STEP = 25;

// The chip and the search survive the panel being hidden (a sidebar tab switch unmounts it), so
// coming back finds the list as it was left.
const memory = { filter: "all" as FavoriteFilter, query: "" };

/** `bare`: inside a sidebar section, which shows the title and the live badge. */
defineProps<{ bare?: boolean }>();

const { t, locale } = useI18n();
const { favorites, removeFavorite } = useFavorites();
const { statusOf } = useFavoritesLive();
const { openFavorite } = useOpenFavorite();
const favoriteMenu = useFavoriteMenu();

const filter = ref<FavoriteFilter>(memory.filter);
const query = ref(memory.query);
const shown = ref(INITIAL);
watch(filter, (value) => (memory.filter = value));
watch(query, (value) => (memory.query = value));
const collapsedGroups = useStorage<FavoriteSectionId[]>("favorites-collapsed-groups", []);

const view = computed(() =>
  favoriteView(favorites.value, statusOf, { filter: filter.value, query: query.value })
);

// A chip that no longer applies (the last live channel went offline) falls back to everything.
watch(
  () => view.value.chips,
  (chips) => {
    if (!chips.some((chip) => chip.key === filter.value)) filter.value = "all";
  }
);

const searching = computed(() => query.value.trim() !== "");
const narrowed = computed(() => filter.value !== "all" || searching.value);
// A search shows every match: one hidden in a collapsed group would look like no match at all.
const groupOpen = (id: FavoriteSectionId) => searching.value || !collapsedGroups.value.includes(id);
const toggleGroup = (id: FavoriteSectionId) => {
  if (searching.value) return;
  collapsedGroups.value = collapsedGroups.value.includes(id)
    ? collapsedGroups.value.filter((g) => g !== id)
    : [...collapsedGroups.value, id];
};
const othersTotal = computed(
  () => view.value.sections.find((s) => s.id === "others")?.rows.length ?? 0
);
const rowsOf = (id: FavoriteSectionId, rows: FavoriteViewRow[]) =>
  id === "others" && !narrowed.value ? rows.slice(0, shown.value) : rows;
// Under a "Pinned" heading the pin in front of each name says nothing new.
const pinHeaded = computed(
  () => view.value.sections.length > 1 && view.value.sections[0]?.id === "pinned"
);

const chipLabel = (key: string) =>
  key.startsWith("site:") ? key.slice("site:".length) : t(`favoritesPanel.chips.${key}`);
const pickChip = (key: string) => {
  filter.value = filter.value === key && key !== "all" ? "all" : key;
};
const resetFilters = () => {
  query.value = "";
  filter.value = "all";
};

const formatViewers = (count?: number) =>
  count === undefined
    ? t("favoritesPanel.live")
    : new Intl.NumberFormat(locale.value, { notation: "compact", maximumFractionDigits: 1 }).format(
        count
      );

const keyOf = (f: FavoriteChannel) => `${f.platform}:${f.channel}:${f.iframeUrl ?? ""}`;
const faviconOf = (row: FavoriteViewRow) =>
  row.favorite.faviconUrl || (row.url ? siteFaviconForUrl(row.url) : "");
const brokenIcons = ref(new Set<string>());
const tooltipOf = (row: FavoriteViewRow) =>
  [row.url || row.favorite.channel, row.detail, t("favoritesPanel.rightClick")]
    .filter(Boolean)
    .join(" · ");

const onMenu = (event: MouseEvent, f: FavoriteChannel) =>
  favoriteMenu.open(event, {
    channel: f.channel,
    platform: f.platform,
    iframeUrl: f.iframeUrl,
    siteUrl: f.siteUrl,
    displayName: f.displayName,
  });
</script>

<template>
  <section
    data-testid="favorites-panel"
    class="flex flex-col gap-2"
    :class="bare ? '' : 'px-2 py-2'"
  >
    <div v-if="!bare" class="flex items-center gap-2 px-0.5">
      <Heart class="size-3.5 text-gray-400 shrink-0" aria-hidden="true" />
      <h2 class="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
        {{ t("favoritesPanel.title") }}
      </h2>
      <span
        v-if="view.liveCount > 0"
        data-testid="favorites-live-badge"
        class="flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300"
        :title="t('favoritesPanel.liveBadgeTitle', { count: view.liveCount })"
      >
        <span class="size-1.5 rounded-full bg-rose-500" aria-hidden="true" />
        {{ t("favoritesPanel.liveBadge", { count: view.liveCount }) }}
      </span>
    </div>

    <p v-if="favorites.length === 0" class="px-1 text-[11px] text-gray-500 leading-normal">
      {{ t("favoritesPanel.empty") }}
    </p>

    <template v-else>
      <label
        v-if="favorites.length >= SEARCH_FROM"
        class="flex items-center gap-2 h-9 rounded-lg border border-[#2a2d33] bg-[#191b1f] px-2.5 focus-within:border-[#3a3f4b]"
      >
        <Search class="size-3.5 text-gray-500 shrink-0" aria-hidden="true" />
        <input
          v-model="query"
          data-testid="favorites-search"
          type="text"
          spellcheck="false"
          :aria-label="t('favoritesPanel.searchLabel')"
          :placeholder="t('favoritesPanel.searchPlaceholder', { count: favorites.length })"
          class="flex-1 min-w-0 bg-transparent text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none"
          @keydown.esc.stop.prevent="
            query = '';
            ($event.target as HTMLInputElement).blur();
          "
        />
        <button
          v-if="query"
          type="button"
          class="text-gray-500 hover:text-white"
          :aria-label="t('favoritesPanel.clear')"
          :title="t('favoritesPanel.clear')"
          @click="query = ''"
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </label>

      <div
        v-if="view.chips.length > 1"
        class="flex flex-wrap gap-1.5"
        role="group"
        :aria-label="t('favoritesPanel.filterLabel')"
      >
        <button
          v-for="chip in view.chips"
          :key="chip.key"
          type="button"
          :data-testid="`favorites-chip-${chip.key}`"
          :aria-pressed="filter === chip.key"
          class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            filter === chip.key
              ? 'border-transparent bg-gray-100 text-[#14161a]'
              : chip.key === 'live'
                ? 'border-rose-500/50 text-gray-200 hover:bg-rose-500/10'
                : 'border-[#2a2d33] text-gray-300 hover:bg-[#1f2227] hover:text-white'
          "
          @click="pickChip(chip.key)"
        >
          <span
            v-if="chip.key === 'live'"
            class="size-1.5 rounded-full bg-rose-500"
            aria-hidden="true"
          />
          <span class="max-w-28 truncate">{{ chipLabel(chip.key) }}</span>
          <span
            class="tabular-nums"
            :class="filter === chip.key ? 'text-[#14161a]/60' : 'text-gray-500'"
            >{{ chip.count }}</span
          >
        </button>
      </div>

      <div v-if="view.matched === 0" class="px-1 text-[11px] text-gray-500 leading-normal">
        {{
          searching
            ? t("favoritesPanel.noMatch", { query: query.trim() })
            : t("favoritesPanel.noneHere")
        }}
        <button
          v-if="narrowed"
          type="button"
          class="ml-1 underline text-gray-300 hover:text-white"
          @click="resetFilters"
        >
          {{ t("favoritesPanel.showAll") }}
        </button>
      </div>

      <div v-else class="flex flex-col gap-0.5">
        <div v-for="section in view.sections" :key="section.id" class="flex flex-col gap-0.5">
          <button
            v-if="view.sections.length > 1"
            type="button"
            :data-testid="`favorites-group-${section.id}`"
            :aria-expanded="groupOpen(section.id)"
            :title="
              searching
                ? t('favoritesPanel.allShownWhileSearching')
                : groupOpen(section.id)
                  ? t('favoritesPanel.collapse')
                  : t('favoritesPanel.expand')
            "
            class="flex items-center gap-1.5 px-1 pt-2 pb-1 text-[10px] font-semibold tracking-widest uppercase text-gray-500 hover:text-gray-300"
            @click="toggleGroup(section.id)"
          >
            <ChevronRight
              class="size-3 transition-transform"
              :class="groupOpen(section.id) ? 'rotate-90' : ''"
              aria-hidden="true"
            />
            {{ t(`favoritesPanel.groups.${section.id}`) }}
            <span class="tabular-nums">{{ section.rows.length }}</span>
          </button>
          <template v-if="view.sections.length === 1 || groupOpen(section.id)">
            <div
              v-for="row in rowsOf(section.id, section.rows)"
              :key="keyOf(row.favorite)"
              class="group/fav flex items-center rounded-md hover:bg-[#1f2227] transition-colors"
              :class="row.offline ? 'opacity-55' : ''"
              @contextmenu="onMenu($event, row.favorite)"
            >
              <button
                type="button"
                :data-testid="`favorite-row-${row.favorite.channel}`"
                class="flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1.5 text-left"
                :title="tooltipOf(row)"
                @click="openFavorite(row.favorite)"
              >
                <Pin
                  v-if="row.favorite.pinned && !pinHeaded"
                  class="size-3 text-gray-500 shrink-0"
                  aria-hidden="true"
                />
                <span class="size-4 shrink-0 flex items-center justify-center">
                  <TwitchIcon
                    v-if="row.favorite.platform === 'twitch'"
                    class="size-4 text-[#9146FF]"
                  />
                  <KickIcon
                    v-else-if="row.favorite.platform === 'kick'"
                    class="size-4 text-[#53FC18]"
                  />
                  <YoutubeIcon
                    v-else-if="row.favorite.platform === 'youtube'"
                    class="size-4 text-[#FF0000]"
                  />
                  <img
                    v-else-if="faviconOf(row) && !brokenIcons.has(keyOf(row.favorite))"
                    :src="faviconOf(row)"
                    alt=""
                    loading="lazy"
                    class="size-4 rounded-sm"
                    @error="brokenIcons = new Set([...brokenIcons, keyOf(row.favorite)])"
                  />
                  <CustomIcon v-else class="size-4 text-[#6366F1]" />
                </span>
                <span class="flex-1 min-w-0 truncate text-sm font-semibold text-gray-100">{{
                  row.label
                }}</span>
                <span
                  v-if="row.live"
                  class="flex items-center gap-1 text-xs font-semibold text-rose-400 shrink-0"
                >
                  <span class="size-1.5 rounded-full bg-rose-500" aria-hidden="true" />
                  {{ formatViewers(row.viewerCount) }}
                </span>
              </button>
              <button
                type="button"
                class="mr-1 p-1 rounded text-gray-500 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover/fav:opacity-100 focus-visible:opacity-100 transition-opacity"
                :aria-label="t('favoritesPanel.remove')"
                :title="t('favoritesPanel.remove')"
                @click="
                  removeFavorite(
                    row.favorite.channel,
                    row.favorite.platform,
                    row.favorite.iframeUrl
                  )
                "
              >
                <X class="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </template>
        </div>
        <div
          v-if="!narrowed && (view.sections.length === 1 || groupOpen('others'))"
          class="flex gap-1.5 px-1 pt-1"
        >
          <button
            v-if="othersTotal > shown"
            type="button"
            data-testid="favorites-show-more"
            class="text-[11px] text-gray-400 hover:text-white"
            @click="shown += STEP"
          >
            {{ t("favoritesPanel.showMore", { count: Math.min(othersTotal - shown, STEP) }) }}
          </button>
          <button
            v-if="shown > INITIAL"
            type="button"
            class="text-[11px] text-gray-400 hover:text-white"
            @click="shown = INITIAL"
          >
            {{ t("favoritesPanel.showLess") }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
