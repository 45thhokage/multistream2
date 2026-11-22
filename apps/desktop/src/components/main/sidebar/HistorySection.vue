<script setup lang="ts">
/** What was watched lately (adapted from Multi Worldview's History section, MIT). */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Search, Star, X } from "@lucide/vue";
import TwitchIcon from "@/components/icons/TwitchIcon.vue";
import KickIcon from "@/components/icons/KickIcon.vue";
import YoutubeIcon from "@/components/icons/YoutubeIcon.vue";
import CustomIcon from "@/components/icons/CustomIcon.vue";
import { useRecents, type RecentChannel } from "@/composables/useRecents";
import { useFavorites } from "@/composables/useFavorites";
import { useFavoriteMenu } from "@/composables/useFavoriteMenu";
import { useOpenFavorite } from "@/composables/useOpenFavorite";

const INITIAL = 8;
const STEP = 25;

const props = defineProps<{ searching?: boolean }>();
const emit = defineEmits<{ "update:searching": [value: boolean] }>();

const { t } = useI18n();
const { recents, removeRecent } = useRecents();
const { favorites, addFavorite } = useFavorites();
const { openFavorite } = useOpenFavorite();
const favoriteMenu = useFavoriteMenu();

const query = ref("");
const shown = ref(INITIAL);
const nameOf = (r: RecentChannel) => r.displayName || r.handle || r.channel;
const matching = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return recents.value;
  return recents.value.filter((r) =>
    [nameOf(r), r.channel, r.iframeUrl].some((v) => v && v.toLowerCase().includes(q))
  );
});
const visible = computed(() =>
  query.value.trim() ? matching.value : matching.value.slice(0, shown.value)
);
const isFavorite = (r: RecentChannel) =>
  favorites.value.some(
    (f) =>
      f.platform === r.platform &&
      (r.platform === "custom"
        ? f.iframeUrl === r.iframeUrl
        : f.channel.replace(/^@+/, "").toLowerCase() === (r.handle || r.channel).toLowerCase())
  );
const open = (r: RecentChannel) =>
  void openFavorite({
    channel: r.platform === "youtube" ? r.handle || r.channel : r.channel,
    platform: r.platform,
    iframeUrl: r.iframeUrl,
    displayName: r.displayName,
  });
const star = (r: RecentChannel) =>
  addFavorite(
    r.platform === "youtube" ? r.handle || r.channel : r.channel,
    r.platform,
    r.iframeUrl,
    {
      displayName: r.displayName,
      ...(r.iframeUrl && { siteUrl: r.iframeUrl }),
    }
  );
const onMenu = (event: MouseEvent, r: RecentChannel) =>
  favoriteMenu.open(event, {
    channel: r.platform === "youtube" ? r.handle || r.channel : r.channel,
    platform: r.platform,
    iframeUrl: r.iframeUrl,
    displayName: r.displayName,
  });

const closeSearch = () => {
  query.value = "";
  emit("update:searching", false);
};

const icon =
  "p-1 rounded text-gray-500 hover:text-white hover:bg-white/10 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity";
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="history-section">
    <label
      v-if="props.searching"
      class="flex items-center gap-2 h-9 rounded-lg border border-[#2a2d33] bg-[#191b1f] px-2.5 focus-within:border-[#3a3f4b]"
    >
      <Search class="size-3.5 text-gray-500 shrink-0" aria-hidden="true" />
      <input
        v-model="query"
        data-testid="history-search"
        type="text"
        spellcheck="false"
        autofocus
        :aria-label="t('sidebarSections.history.searchLabel')"
        :placeholder="t('sidebarSections.history.searchPlaceholder', { count: recents.length })"
        class="flex-1 min-w-0 bg-transparent text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none"
        @keydown.esc.stop.prevent="closeSearch"
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

    <p v-if="visible.length === 0" class="px-1 text-[11px] text-gray-500">
      {{
        query.trim()
          ? t("sidebarSections.history.noMatch", { query: query.trim() })
          : t("sidebarSections.history.empty")
      }}
    </p>
    <div v-else class="flex flex-col gap-0.5">
      <div
        v-for="recent in visible"
        :key="`${recent.platform}:${recent.channel}:${recent.iframeUrl ?? ''}`"
        class="group/row flex items-center rounded-md hover:bg-[#1f2227] transition-colors"
        @contextmenu="onMenu($event, recent)"
      >
        <button
          type="button"
          :data-testid="`history-row-${recent.channel}`"
          class="flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1.5 text-left"
          :title="recent.iframeUrl || nameOf(recent)"
          @click="open(recent)"
        >
          <span class="size-4 shrink-0 flex items-center justify-center">
            <TwitchIcon v-if="recent.platform === 'twitch'" class="size-4 text-[#9146FF]" />
            <KickIcon v-else-if="recent.platform === 'kick'" class="size-4 text-[#53FC18]" />
            <YoutubeIcon v-else-if="recent.platform === 'youtube'" class="size-4 text-[#FF0000]" />
            <CustomIcon v-else class="size-4 text-[#6366F1]" />
          </span>
          <span class="flex-1 min-w-0 truncate text-sm text-gray-200">{{ nameOf(recent) }}</span>
        </button>
        <button
          v-if="!isFavorite(recent)"
          type="button"
          :class="icon"
          :title="t('sidebarSections.history.addFavorite')"
          :aria-label="t('sidebarSections.history.addFavorite')"
          @click="star(recent)"
        >
          <Star class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="[icon, 'mr-1 hover:!text-red-300 hover:!bg-red-500/10']"
          :title="t('sidebarSections.history.remove')"
          :aria-label="t('sidebarSections.history.remove')"
          @click="removeRecent(recent.channel, recent.platform, recent.iframeUrl)"
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div v-if="!query.trim()" class="flex gap-2 px-1 pt-1">
        <button
          v-if="matching.length > shown"
          type="button"
          class="text-[11px] text-gray-400 hover:text-white"
          @click="shown += STEP"
        >
          {{ t("favoritesPanel.showMore", { count: Math.min(matching.length - shown, STEP) }) }}
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
  </div>
</template>
