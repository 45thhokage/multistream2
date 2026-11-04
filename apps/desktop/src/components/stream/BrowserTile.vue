<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  GripVertical,
  Heart,
  Maximize2,
  Monitor,
  RotateCw,
  Smartphone,
  X,
} from "@lucide/vue";
import { useBrowserTiles, type TileRect } from "@/composables/useBrowserTiles";
import { useDragAndDrop } from "@/composables/useDragAndDrop";
import { useFavorites } from "@/composables/useFavorites";
import { useFocusedStream } from "@/composables/useFocusedStream";
import { useSiteWindows } from "@/composables/useSiteWindows";
import { useStreams, type Platform } from "@/composables/useStreams";
import { ensureHttpUrl, siteFaviconForUrl } from "@/lib/siteMeta";
import { isTauri } from "@/lib/http";

const props = defineProps<{
  channel: string;
  channelid: string;
  iframeUrl: string;
}>();

const {
  openTile,
  closeTile,
  navigateTile,
  reloadTile,
  goBackTile,
  goForwardTile,
  syncTileBounds,
  titles,
  urls,
} = useBrowserTiles();
const { onMouseDown } = useDragAndDrop();
const { requestRemoveStream } = useStreams();
const { addFavorite, removeFavorite, favorites } = useFavorites();
const { toggleFocus, isFocused, clearFocus } = useFocusedStream();
const { openSite } = useSiteWindows();

const isNativeTile = isTauri();
const viewportRef = ref<HTMLElement | null>(null);
const addressInput = ref<HTMLInputElement | null>(null);
const addressDraft = ref("");
const ready = ref(false);
const mobileView = ref(false);
let observer: ResizeObserver | null = null;

const safeUrl = computed(() => ensureHttpUrl(props.iframeUrl) ?? "");

const currentUrl = computed(() => urls.value[props.channelid] ?? safeUrl.value);

const pageTitle = computed(() => titles.value[props.channelid] ?? safeUrl.value);

const isFavorite = computed(() =>
  favorites.value.find(
    (f) =>
      f.channel.toLowerCase() === props.channel.toLowerCase() &&
      f.platform === "custom" &&
      (f.iframeUrl ?? f.siteUrl ?? "") === (currentUrl.value || "")
  )
);

const measure = (): TileRect | null => {
  const el = viewportRef.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};

const pushBounds = (): void => {
  const rect = measure();
  if (rect) void syncTileBounds(props.channelid, rect);
};

const submitAddress = (): void => {
  const url = ensureHttpUrl(addressDraft.value);
  if (!url) {
    addressDraft.value = currentUrl.value;
    return;
  }
  void navigateTile(props.channelid, url);
};

watch(currentUrl, (url) => {
  if (typeof document !== "undefined" && document.activeElement === addressInput.value) return;
  addressDraft.value = url;
});

watch(safeUrl, (url) => {
  if (url) void navigateTile(props.channelid, url);
});

onMounted(() => {
  addressDraft.value = currentUrl.value;
  if (!isNativeTile) {
    ready.value = true;
    return;
  }
  nextTick(() => {
    requestAnimationFrame(() => {
      const rect = measure();
      if (!rect || !safeUrl.value) return;
      void openTile(props.channelid, safeUrl.value, rect).then(() => {
        ready.value = true;
        pushBounds();
      });
    });
  });
  if (typeof ResizeObserver !== "undefined" && viewportRef.value) {
    observer = new ResizeObserver(pushBounds);
    observer.observe(viewportRef.value);
  }
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
  if (isNativeTile) void closeTile(props.channelid);
});

const handleFavorite = () => {
  const platform: Platform = "custom";
  const url = currentUrl.value || safeUrl.value;
  if (isFavorite.value) {
    removeFavorite(props.channel, platform, url || undefined);
  } else if (url) {
    addFavorite(props.channel, platform, url, {
      displayName: pageTitle.value,
      faviconUrl: siteFaviconForUrl(url),
      siteUrl: url,
    });
  }
};

const handleFocus = () => {
  if (isFocused(props.channelid)) clearFocus();
  else toggleFocus(props.channelid);
};

const handlePopOut = () => {
  const url = currentUrl.value || safeUrl.value;
  if (url) void openSite(url, pageTitle.value);
};

const toggleMobileView = async () => {
  if (!isNativeTile) return;
  mobileView.value = !mobileView.value;
  const rect = measure();
  const url = currentUrl.value || safeUrl.value;
  if (!rect || !url) return;
  ready.value = false;
  await closeTile(props.channelid);
  await openTile(props.channelid, url, rect, mobileView.value);
  ready.value = true;
  pushBounds();
};
</script>

<template>
  <div :data-testid="`browser-tile-${channel}`" class="flex flex-col h-full bg-[#0f1115]">
    <header
      class="flex items-center gap-1 px-1.5 h-10 shrink-0 bg-[#14161a] border-b border-[#2a2d33]"
    >
      <span
        class="p-1.5 rounded text-white/40 cursor-grab active:cursor-grabbing hover:text-white min-h-[32px] min-w-[32px] flex items-center justify-center"
        :aria-label="$t('browser.dragTile')"
        @mousedown.stop="onMouseDown(channelid)"
      >
        <GripVertical class="size-4" aria-hidden="true" />
      </span>
      <button
        type="button"
        :data-testid="`browser-back-${channel}`"
        :aria-label="$t('browser.back')"
        class="p-1.5 rounded text-white/70 hover:text-white hover:bg-[#1f2227] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[32px] min-w-[32px] flex items-center justify-center"
        @click="goBackTile(channelid)"
      >
        <ArrowLeft class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        :data-testid="`browser-forward-${channel}`"
        :aria-label="$t('browser.forward')"
        class="p-1.5 rounded text-white/70 hover:text-white hover:bg-[#1f2227] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[32px] min-w-[32px] flex items-center justify-center"
        @click="goForwardTile(channelid)"
      >
        <ArrowRight class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        :data-testid="`browser-reload-${channel}`"
        :aria-label="$t('browser.reload')"
        class="p-1.5 rounded text-white/70 hover:text-white hover:bg-[#1f2227] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[32px] min-w-[32px] flex items-center justify-center"
        @click="reloadTile(channelid)"
      >
        <RotateCw class="size-4" aria-hidden="true" />
      </button>
      <form class="flex-1 min-w-0" @submit.prevent="submitAddress">
        <label :for="`browser-address-${channelid}`" class="sr-only">{{
          $t("browser.address")
        }}</label>
        <input
          :id="`browser-address-${channelid}`"
          ref="addressInput"
          v-model="addressDraft"
          :data-testid="`browser-address-${channel}`"
          type="text"
          spellcheck="false"
          :placeholder="$t('browser.addressPlaceholder')"
          class="w-full h-8 px-2.5 rounded-md bg-[#1f2227] border border-[#2a2d33] text-xs text-[#eaeaea] placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
      </form>
      <button
        v-if="isNativeTile"
        type="button"
        :data-testid="`browser-view-toggle-${channel}`"
        :aria-label="mobileView ? $t('browser.desktopView') : $t('browser.mobileView')"
        :title="mobileView ? $t('browser.desktopView') : $t('browser.mobileView')"
        :class="[
          'p-1.5 rounded hover:bg-[#1f2227] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[32px] min-w-[32px] hidden sm:flex items-center justify-center',
          mobileView ? 'text-indigo-400 hover:text-indigo-300' : 'text-white/70 hover:text-white',
        ]"
        @click="toggleMobileView"
      >
        <Smartphone v-if="!mobileView" class="size-4" aria-hidden="true" />
        <Monitor v-else class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        :aria-label="isFavorite ? $t('stream.actions.unfavorite') : $t('stream.actions.favorite')"
        class="p-1.5 rounded text-white/70 hover:text-white hover:bg-[#1f2227] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[32px] min-w-[32px] hidden sm:flex items-center justify-center"
        @click="handleFavorite"
      >
        <Heart
          class="size-4 transition-colors"
          :fill="isFavorite ? 'currentColor' : 'none'"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        :aria-label="
          isFocused(channelid) ? $t('stream.actions.unfocus') : $t('stream.actions.focus')
        "
        class="p-1.5 rounded text-white/70 hover:text-white hover:bg-[#1f2227] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[32px] min-w-[32px] hidden sm:flex items-center justify-center"
        @click="handleFocus"
      >
        <Maximize2 class="size-4" aria-hidden="true" />
      </button>
      <button
        v-if="safeUrl"
        type="button"
        :aria-label="$t('stream.actions.openInWindow')"
        class="p-1.5 rounded text-white/70 hover:text-white hover:bg-[#1f2227] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[32px] min-w-[32px] flex items-center justify-center"
        @click="handlePopOut"
      >
        <ExternalLink class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        :data-testid="`remove-stream-${channel}`"
        :aria-label="$t('stream.actions.remove')"
        class="p-1.5 rounded text-white/70 hover:text-white hover:bg-red-500/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[32px] min-w-[32px] flex items-center justify-center"
        @click="requestRemoveStream(channelid)"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </header>
    <div
      ref="viewportRef"
      :data-testid="`browser-viewport-${channel}`"
      class="relative flex-1 min-h-0 bg-[#0f1115]"
    >
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-white/30"
      >
        <RotateCw class="size-5 animate-spin" aria-hidden="true" />
        <p>{{ $t("browser.loading", { title: pageTitle }) }}</p>
      </div>
      <iframe
        v-if="!isNativeTile && safeUrl"
        :data-testid="`browser-fallback-${channel}`"
        :title="`Custom Stream: ${channel}`"
        :src="safeUrl"
        allowfullscreen
        allow="autoplay; encrypted-media; fullscreen"
        class="absolute inset-0 block w-full h-full border-0"
      />
    </div>
  </div>
</template>
