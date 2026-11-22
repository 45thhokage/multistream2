<script setup lang="ts">
/**
 * Who is live among the channels you follow (Twitch sign-in) and your favorites. `folded`: the
 * narrow sidebar's strip of avatars. `includeSites`: also list favorite websites (only when the
 * Favorites section is not on screen to list them).
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Radio, RefreshCw } from "@lucide/vue";
import ChannelPreview from "../ChannelPreview.vue";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import TwitchIcon from "@/components/icons/TwitchIcon.vue";
import KickIcon from "@/components/icons/KickIcon.vue";
import YoutubeIcon from "@/components/icons/YoutubeIcon.vue";
import CustomIcon from "@/components/icons/CustomIcon.vue";
import { useNativeOverlay } from "@/composables/useNativeOverlay";
import { useFollowedChannels, type FollowedChannel } from "@/composables/useFollowedChannels";
import { useFavoriteMenu } from "@/composables/useFavoriteMenu";
import { useStreams } from "@/composables/useStreams";
import { useNetworkStatus } from "@/composables/useNetworkStatus";
import { channelThumbnail } from "@/lib/channelThumbnail";
import { CDN_CONFIG } from "@/config/cdn";

const props = defineProps<{ folded?: boolean; includeSites?: boolean }>();

const preview = useNativeOverlay("preview");
const { channels, allChannels, isLoading, isInitialLoading, platformFilter, refresh } =
  useFollowedChannels();
const { isOnline } = useNetworkStatus();
const { addStream } = useStreams();
const { t, locale } = useI18n();
const favoriteMenu = useFavoriteMenu();

const listed = computed(() => {
  if (props.folded) return allChannels.value;
  return props.includeSites
    ? channels.value
    : channels.value.filter((c) => c.platform !== "custom");
});
const liveChannels = computed(() => listed.value.filter((c) => c.isLive));
const liveCount = computed(
  () => allChannels.value.filter((c) => c.isLive && c.platform !== "custom").length
);
defineExpose({ liveCount, refresh, isLoading });

const onChannelMenu = (event: MouseEvent, channel: FollowedChannel) =>
  favoriteMenu.open(event, {
    channel: channel.platform === "youtube" ? channel.handle || channel.id : channel.id,
    platform: channel.platform,
    iframeUrl: channel.iframeUrl,
    displayName: channel.displayName,
  });

const onAddClick = (channel: FollowedChannel) => {
  if (channel.platform === "custom") {
    addStream(channel.id, "custom", channel.iframeUrl);
  } else if (channel.platform === "youtube") {
    addStream(
      channel.videoId || channel.id,
      channel.platform,
      undefined,
      channel.displayName,
      channel.handle || channel.id.replace(/^@+/, "")
    );
  } else {
    addStream(channel.id, channel.platform);
  }
};

const formatViewers = (count: number) =>
  new Intl.NumberFormat(locale.value, { notation: "compact", maximumFractionDigits: 1 }).format(
    count
  );

const showPreview = (channel: FollowedChannel, event: Event) => {
  if (!preview.available) return;
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = Math.min(256, window.innerWidth - 16);
  const height = (width * 9) / 16 + 66;
  preview.show(
    {
      x: Math.min(box.right + 10, window.innerWidth - width - 8),
      y: Math.max(8, Math.min(box.top, window.innerHeight - height - 8)),
      width,
      height,
    },
    {
      thumbnail: channelThumbnail(channel),
      title: channel.title || channel.displayName,
      category: channel.game || "",
    }
  );
};

const handleAvatarError = (event: Event, displayName: string) => {
  const target = event.target as HTMLImageElement | null;
  if (target) target.src = CDN_CONFIG.avatarFallback(displayName);
};

const filters = [
  { id: "twitch", icon: TwitchIcon, on: "text-[#9146FF] bg-[#9146ff]/10", label: "Twitch" },
  { id: "kick", icon: KickIcon, on: "text-[#53FC18] bg-[#53fc18]/10", label: "Kick" },
  { id: "youtube", icon: YoutubeIcon, on: "text-[#FF0000] bg-[#FF0000]/10", label: "YouTube" },
] as const;
</script>

<template>
  <div class="flex flex-col gap-0.5" data-testid="following-section">
    <div v-if="!folded" class="flex items-center justify-between pb-1">
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="px-1.5 py-1 rounded text-[10px] font-bold tracking-wider uppercase transition-colors"
          :class="
            platformFilter === 'all'
              ? 'text-white bg-[#1f2227]'
              : 'text-gray-500 hover:text-gray-300'
          "
          :title="t('sidebar.all')"
          @click="platformFilter = 'all'"
        >
          {{ t("sidebar.all") }}
        </button>
        <button
          v-for="filter in filters"
          :key="filter.id"
          type="button"
          class="p-1 rounded transition-colors"
          :class="platformFilter === filter.id ? filter.on : 'text-gray-500 hover:text-gray-300'"
          :title="filter.label"
          :aria-label="filter.label"
          :aria-pressed="platformFilter === filter.id"
          @click="platformFilter = filter.id"
        >
          <component :is="filter.icon" class="w-3.5 h-3.5" />
        </button>
      </div>
      <button
        type="button"
        class="text-gray-500 hover:text-gray-300 transition-colors p-1 -mr-1 rounded-md"
        :class="{ 'pointer-events-none opacity-40': isLoading || !isOnline }"
        :disabled="isLoading || !isOnline"
        :title="!isOnline ? t('network.offlineTooltip') : t('sidebarSections.following.refresh')"
        :aria-label="t('sidebarSections.following.refresh')"
        @click="refresh"
      >
        <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin text-gray-400': isLoading }" />
      </button>
    </div>

    <TooltipProvider :delay-duration="0" :disable-hoverable-content="true">
      <template v-if="isInitialLoading">
        <div v-for="i in folded ? 6 : 4" :key="i" class="flex items-center gap-2 p-1">
          <Skeleton class="w-7 h-7 rounded-full shrink-0 bg-[#1f2227]" />
          <div v-if="!folded" class="flex-1 min-w-0 space-y-1">
            <Skeleton class="h-3.5 w-24 bg-[#1f2227]" />
            <Skeleton class="h-3 w-32 bg-[#1f2227]" />
          </div>
        </div>
      </template>

      <template v-else-if="liveChannels.length > 0">
        <Tooltip
          v-for="channel in liveChannels"
          :key="channel.platform + '-' + (channel.iframeUrl ?? channel.id)"
        >
          <TooltipTrigger as-child>
            <div
              class="flex items-center gap-2 p-1 rounded-md cursor-pointer hover:bg-[#1f2227] transition-colors"
              :class="folded ? 'justify-center' : ''"
              role="button"
              tabindex="0"
              :data-testid="`following-row-${channel.id}`"
              @mouseenter="showPreview(channel, $event)"
              @mouseleave="preview.close"
              @focus="showPreview(channel, $event)"
              @blur="preview.close"
              @keydown.enter.prevent="onAddClick(channel)"
              @keydown.space.prevent="onAddClick(channel)"
              @click.stop="onAddClick(channel)"
              @contextmenu="onChannelMenu($event, channel)"
            >
              <div class="relative shrink-0">
                <div class="avatar-border rounded-full" :class="{ followed: channel.isFollowed }">
                  <img
                    loading="lazy"
                    :src="channel.avatarUrl || CDN_CONFIG.avatarFallback(channel.displayName)"
                    class="w-7 h-7 rounded-full block object-cover"
                    alt=""
                    @error="handleAvatarError($event, channel.displayName)"
                  />
                </div>
                <div
                  class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border border-[#14161a] flex items-center justify-center bg-[#0f1115]"
                >
                  <TwitchIcon
                    v-if="channel.platform === 'twitch'"
                    class="w-2.5 h-2.5 text-[#9146FF]"
                  />
                  <KickIcon v-if="channel.platform === 'kick'" class="w-2.5 h-2.5 text-[#53FC18]" />
                  <YoutubeIcon
                    v-if="channel.platform === 'youtube'"
                    class="w-2.5 h-2.5 text-[#FF0000]"
                  />
                  <CustomIcon
                    v-if="channel.platform === 'custom'"
                    class="w-2.5 h-2.5 text-[#6366F1]"
                  />
                </div>
              </div>
              <div v-if="!folded" class="flex-1 min-w-0 flex flex-col justify-center">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-medium text-gray-200 truncate">{{
                    channel.displayName
                  }}</span>
                  <div
                    v-if="channel.platform !== 'custom'"
                    class="flex items-center gap-1 text-rose-400 shrink-0"
                  >
                    <div class="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                    <span class="text-xs font-semibold">{{
                      formatViewers(channel.viewerCount || 0)
                    }}</span>
                  </div>
                </div>
                <span v-if="channel.game || channel.title" class="text-xs text-gray-400 truncate">{{
                  channel.game || channel.title
                }}</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent
            v-if="!preview.available"
            side="right"
            :side-offset="10"
            class="w-64 p-0 bg-[#0f1115] border-0 rounded-lg overflow-hidden"
            hide-arrow
          >
            <ChannelPreview
              :thumbnail="channelThumbnail(channel)"
              :title="channel.title || channel.displayName"
              :category="channel.game"
            />
          </TooltipContent>
        </Tooltip>
      </template>

      <div v-else class="flex flex-col items-center justify-center py-4 text-center select-none">
        <template v-if="!folded">
          <span class="text-xs font-semibold text-gray-400 leading-snug">{{
            t("sidebar.noChannels")
          }}</span>
          <span class="text-[11px] text-gray-500 mt-1 leading-normal max-w-[200px]">{{
            t("sidebar.noChannelsSubtitle")
          }}</span>
        </template>
        <Tooltip v-else>
          <TooltipTrigger as-child>
            <div class="p-2 text-gray-600">
              <Radio class="w-4 h-4 opacity-50" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" :side-offset="10">
            <p class="text-xs font-medium">{{ t("sidebar.noChannels") }}</p>
            <p class="text-[10px] text-gray-400 mt-0.5">{{ t("sidebar.noChannelsSubtitle") }}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  </div>
</template>

<style scoped>
.avatar-border {
  padding: 1.5px;
  background: #2a2d33;
}
.avatar-border.followed {
  background: #9146ff;
}
</style>
