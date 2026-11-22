<script setup lang="ts">
/**
 * The left sidebar, laid out like Multi Worldview's (MIT): Streams, Layout, Following, Favorites,
 * Presets, History and Workspaces.
 *  - Tabbed (Settings → Tabbed sidebar): one section at a time, from a strip of icon tabs where
 *    only the active tab shows its name.
 *  - Stacked: every section in one column, each folding on its own, plus Collapse / Expand all.
 *  - Folded: a narrow rail of the section icons above the avatars of who is live.
 */
import { computed, nextTick, onBeforeUnmount, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Heart,
  LayoutGrid,
  LayoutTemplate,
  Monitor,
  Radio,
  Search,
  Star,
  Trash2,
  WifiOff,
} from "@lucide/vue";
import StreamMixer from "./StreamMixer.vue";
import LayoutPicker from "./LayoutPicker.vue";
import FavoritesPanel from "./FavoritesPanel.vue";
import SidebarSection from "./sidebar/SidebarSection.vue";
import FollowingSection from "./sidebar/FollowingSection.vue";
import PresetsSection from "./sidebar/PresetsSection.vue";
import HistorySection from "./sidebar/HistorySection.vue";
import WorkspacesSection from "./sidebar/WorkspacesSection.vue";
import { useFollowedChannels } from "@/composables/useFollowedChannels";
import { useFavoritesLive } from "@/composables/useFavoritesLive";
import { usePresets } from "@/composables/usePresets";
import { useRecents } from "@/composables/useRecents";
import { useStreams } from "@/composables/useStreams";
import { useWorkspaces } from "@/composables/useWorkspaces";
import { usePreferences, type SidebarTab } from "@/composables/usePreferences";
import { useNetworkStatus } from "@/composables/useNetworkStatus";
import { useImmersiveMode } from "@/composables/useImmersiveMode";
import {
  SIDEBAR_STACK_ORDER,
  SIDEBAR_TAB_ORDER,
  isSidebarTab,
  useSidebarSections,
} from "@/composables/useSidebarSections";

const { t } = useI18n();
const { allChannels, refresh } = useFollowedChannels();
const { liveCount: favoritesLive } = useFavoritesLive();
const { presets } = usePresets();
const { recents, clearRecents } = useRecents();
const { activeStreams } = useStreams();
const { workspaces } = useWorkspaces();
const { isOnline } = useNetworkStatus();
const {
  followedSidebarOpen: isOpen,
  toggleFollowedSidebar,
  tabbedSidebar,
  sidebarTab,
} = usePreferences();
const { immersiveModeEnabled, isLeftPanelRevealed, revealLeftPanel, scheduleHideLeftPanel } =
  useImmersiveMode();
const sectionState = useSidebarSections();

const onPanelMouseEnter = () => {
  if (immersiveModeEnabled.value) revealLeftPanel();
};
const onPanelMouseLeave = () => {
  if (immersiveModeEnabled.value) scheduleHideLeftPanel();
};

const ICONS: Record<SidebarTab, Component> = {
  streams: Monitor,
  layout: LayoutTemplate,
  following: Radio,
  favorites: Heart,
  presets: Star,
  history: Clock,
  workspaces: LayoutGrid,
};
const titleOf = (id: SidebarTab) => t(`sidebarSections.${id}.title`);
const followingLive = computed(
  () => allChannels.value.filter((c) => c.isLive && c.platform !== "custom").length
);
const countOf = (id: SidebarTab): number | undefined => {
  switch (id) {
    case "streams":
      return activeStreams.value.length;
    case "presets":
      return presets.value.length;
    case "history":
      return recents.value.length;
    case "workspaces":
      return workspaces.value.length;
    default:
      return undefined;
  }
};
const liveOf = (id: SidebarTab): number =>
  id === "following" ? followingLive.value : id === "favorites" ? favoritesLive.value : 0;

const activeTab = computed<SidebarTab>(() =>
  isSidebarTab(sidebarTab.value) ? sidebarTab.value : "streams"
);
const order = computed(() => (tabbedSidebar.value ? SIDEBAR_TAB_ORDER : SIDEBAR_STACK_ORDER));

const toggleSidebar = () => {
  toggleFollowedSidebar();
  if (isOpen.value) refresh();
};

/** A section icon in the tab strip or the folded rail. */
const pick = async (id: SidebarTab) => {
  sidebarTab.value = id;
  if (!isOpen.value) toggleSidebar();
  if (tabbedSidebar.value) return;
  sectionState.setCollapsed(id, false);
  await nextTick();
  document
    .querySelector(`[data-sidebar-section="${id}"]`)
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
};

const historySearching = ref(false);
// "Clear" history asks by turning into "Clear all?" for a few seconds.
const confirmingClear = ref(false);
let clearTimer: ReturnType<typeof setTimeout> | undefined;
const clearHistory = () => {
  clearTimeout(clearTimer);
  if (!confirmingClear.value) {
    confirmingClear.value = true;
    clearTimer = setTimeout(() => (confirmingClear.value = false), 3000);
    return;
  }
  confirmingClear.value = false;
  clearRecents();
};
onBeforeUnmount(() => clearTimeout(clearTimer));

const headerButton =
  "p-1 rounded-md text-gray-500 hover:text-white hover:bg-[#1f2227] transition-colors";
</script>

<template>
  <div
    :inert="immersiveModeEnabled && !isLeftPanelRevealed"
    :data-native-cutout="immersiveModeEnabled && isLeftPanelRevealed ? true : undefined"
    data-testid="left-sidebar"
    :class="[
      immersiveModeEnabled
        ? [
            'fixed inset-y-0 left-0 z-50 flex flex-col bg-[#14161a] border-r border-[#2a2d33] shadow-2xl shadow-black/80 transition-transform duration-250 ease-out',
            isOpen ? 'w-72' : 'w-14',
            isLeftPanelRevealed ? 'translate-x-0' : '-translate-x-full pointer-events-none',
          ]
        : [
            'shrink-0 ease-in-out border-r border-[#2a2d33] bg-[#14161a] h-full flex flex-col z-20 relative transition-all duration-300',
            isOpen ? 'w-72' : 'w-14',
          ],
    ]"
    @mouseenter="onPanelMouseEnter"
    @mouseleave="onPanelMouseLeave"
  >
    <!-- header -->
    <div
      class="h-12 flex items-center gap-1 px-2 border-b border-[#1f2227] shrink-0"
      :class="isOpen ? '' : 'justify-center'"
    >
      <template v-if="isOpen">
        <span
          class="flex-1 min-w-0 truncate text-[10px] font-semibold tracking-widest uppercase text-gray-400 pl-1"
          >{{ t("sidebarSections.title") }}</span
        >
        <span
          v-if="!isOnline"
          data-testid="sidebar-offline-indicator"
          class="flex items-center text-zinc-500 cursor-help"
          :aria-label="t('network.offlineTooltip')"
          :title="t('network.offlineTooltip')"
        >
          <WifiOff aria-hidden="true" class="w-3.5 h-3.5" />
        </span>
        <button
          v-if="!tabbedSidebar"
          type="button"
          data-testid="sidebar-collapse-all"
          :class="headerButton"
          :title="
            sectionState.anyExpanded()
              ? t('sidebarSections.collapseAll')
              : t('sidebarSections.expandAll')
          "
          :aria-label="
            sectionState.anyExpanded()
              ? t('sidebarSections.collapseAll')
              : t('sidebarSections.expandAll')
          "
          @click="sectionState.setAll(sectionState.anyExpanded())"
        >
          <component
            :is="sectionState.anyExpanded() ? ChevronsDownUp : ChevronsUpDown"
            class="size-4"
            aria-hidden="true"
          />
        </button>
      </template>
      <span
        v-else-if="!isOnline"
        data-testid="sidebar-offline-indicator"
        class="absolute top-1.5 right-1.5 flex items-center text-zinc-500 cursor-help"
        :aria-label="t('network.offlineTooltip')"
        :title="t('network.offlineTooltip')"
      >
        <WifiOff aria-hidden="true" class="w-3 h-3" />
      </span>
      <button
        type="button"
        data-testid="sidebar-toggle"
        class="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#1f2227] transition-colors"
        :title="isOpen ? t('sidebarSections.fold') : t('sidebarSections.unfold')"
        :aria-label="isOpen ? t('sidebarSections.fold') : t('sidebarSections.unfold')"
        @click="toggleSidebar"
      >
        <ChevronLeft v-if="isOpen" class="w-4 h-4" />
        <ChevronRight v-else class="w-4 h-4" />
      </button>
    </div>

    <!-- folded: section rail, then who is live -->
    <template v-if="!isOpen">
      <nav
        class="shrink-0 flex flex-col items-center gap-0.5 py-1.5 border-b border-[#1f2227]"
        :aria-label="t('sidebarSections.title')"
      >
        <button
          v-for="id in SIDEBAR_TAB_ORDER"
          :key="id"
          type="button"
          :data-testid="`sidebar-rail-${id}`"
          class="relative p-2 rounded-md text-gray-500 hover:text-white hover:bg-[#1f2227] transition-colors"
          :title="titleOf(id)"
          :aria-label="titleOf(id)"
          @click="pick(id)"
        >
          <component :is="ICONS[id]" class="size-4" aria-hidden="true" />
          <span
            v-if="liveOf(id) > 0"
            class="absolute top-1 right-1 size-1.5 rounded-full bg-rose-500"
            aria-hidden="true"
          />
        </button>
      </nav>
      <div class="flex-1 overflow-y-auto py-1 px-1.5 custom-scrollbar">
        <FollowingSection folded />
      </div>
    </template>

    <!-- tabbed: one section at a time -->
    <template v-else-if="tabbedSidebar">
      <div
        role="tablist"
        data-testid="sidebar-tabs"
        :aria-label="t('sidebarSections.title')"
        class="shrink-0 flex border-b border-[#1f2227]"
      >
        <button
          v-for="id in SIDEBAR_TAB_ORDER"
          :key="id"
          type="button"
          role="tab"
          :data-testid="`sidebar-tab-${id}`"
          :aria-selected="activeTab === id"
          :title="titleOf(id)"
          :aria-label="titleOf(id)"
          class="relative flex items-center justify-center gap-1.5 min-w-0 h-10 -mb-px border-b-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:bg-white/5"
          :class="
            activeTab === id
              ? 'shrink-0 px-2.5 border-gray-100 text-white'
              : 'flex-1 border-transparent text-gray-500 hover:text-gray-200'
          "
          @click="pick(id)"
        >
          <component :is="ICONS[id]" class="size-4 shrink-0" aria-hidden="true" />
          <span v-if="activeTab === id" class="truncate">{{ titleOf(id) }}</span>
          <span
            v-if="liveOf(id) > 0 && activeTab !== id"
            class="absolute top-2 right-1/2 translate-x-3 size-1.5 rounded-full bg-rose-500"
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        role="tabpanel"
        class="flex-1 min-h-0 overflow-y-auto p-3 custom-scrollbar"
        :data-testid="`sidebar-pane-${activeTab}`"
      >
        <SidebarSection
          :id="activeTab"
          :icon="ICONS[activeTab]"
          :title="titleOf(activeTab)"
          :count="countOf(activeTab)"
          focused
        >
          <template v-if="liveOf(activeTab) > 0" #badge>
            <span
              class="flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-rose-300"
            >
              <span class="size-1.5 rounded-full bg-rose-500" aria-hidden="true" />
              {{ t("favoritesPanel.liveBadge", { count: liveOf(activeTab) }) }}
            </span>
          </template>
          <template v-if="activeTab === 'history' && recents.length" #actions>
            <button
              type="button"
              :class="headerButton"
              :aria-pressed="historySearching"
              :title="t('sidebarSections.history.searchLabel')"
              :aria-label="t('sidebarSections.history.searchLabel')"
              @click="historySearching = !historySearching"
            >
              <Search class="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="history-clear"
              class="px-1.5 py-1 rounded-md text-[11px] hover:bg-[#1f2227] transition-colors"
              :class="confirmingClear ? 'text-red-300' : 'text-gray-500 hover:text-white'"
              :title="t('sidebarSections.history.clearTitle')"
              @click="clearHistory"
            >
              {{
                confirmingClear
                  ? t("sidebarSections.history.clearConfirm")
                  : t("sidebarSections.history.clear")
              }}
            </button>
          </template>
          <StreamMixer v-if="activeTab === 'streams'" bare />
          <LayoutPicker v-else-if="activeTab === 'layout'" inline />
          <FollowingSection v-else-if="activeTab === 'following'" />
          <FavoritesPanel v-else-if="activeTab === 'favorites'" bare />
          <PresetsSection v-else-if="activeTab === 'presets'" />
          <HistorySection
            v-else-if="activeTab === 'history'"
            v-model:searching="historySearching"
          />
          <WorkspacesSection v-else-if="activeTab === 'workspaces'" />
        </SidebarSection>
      </div>
    </template>

    <!-- stacked: every section, each folding on its own -->
    <div
      v-else
      class="flex-1 min-h-0 overflow-y-auto px-2 py-1 custom-scrollbar"
      data-testid="sidebar-stack"
    >
      <SidebarSection
        v-for="id in order"
        :id="id"
        :key="id"
        :icon="ICONS[id]"
        :title="titleOf(id)"
        :count="countOf(id)"
      >
        <template v-if="liveOf(id) > 0" #badge>
          <span
            class="flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-rose-300"
          >
            <span class="size-1.5 rounded-full bg-rose-500" aria-hidden="true" />
            {{ t("favoritesPanel.liveBadge", { count: liveOf(id) }) }}
          </span>
        </template>
        <template v-if="id === 'history' && recents.length" #actions>
          <button
            type="button"
            :class="headerButton"
            :aria-pressed="historySearching"
            :title="t('sidebarSections.history.searchLabel')"
            :aria-label="t('sidebarSections.history.searchLabel')"
            @click="
              historySearching = !historySearching;
              sectionState.setCollapsed('history', false);
            "
          >
            <Search class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="history-clear"
            class="px-1.5 py-1 rounded-md text-[11px] hover:bg-[#1f2227] transition-colors"
            :class="confirmingClear ? 'text-red-300' : 'text-gray-500 hover:text-white'"
            :title="t('sidebarSections.history.clearTitle')"
            @click="clearHistory"
          >
            <Trash2 v-if="!confirmingClear" class="size-3.5" aria-hidden="true" />
            <span v-else>{{ t("sidebarSections.history.clearConfirm") }}</span>
          </button>
        </template>
        <StreamMixer v-if="id === 'streams'" bare />
        <LayoutPicker v-else-if="id === 'layout'" inline />
        <FollowingSection v-else-if="id === 'following'" />
        <FavoritesPanel v-else-if="id === 'favorites'" bare />
        <PresetsSection v-else-if="id === 'presets'" />
        <HistorySection v-else-if="id === 'history'" v-model:searching="historySearching" />
        <WorkspacesSection v-else-if="id === 'workspaces'" />
      </SidebarSection>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #2a2d33;
  border-radius: 4px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background: #3a3f4b;
}
</style>
