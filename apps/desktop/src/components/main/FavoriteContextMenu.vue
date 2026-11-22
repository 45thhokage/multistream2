<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Bell, BellOff, Copy, Pin, PinOff, Play, Trash2 } from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { useFavoriteMenu } from "@/composables/useFavoriteMenu";
import { useFavorites } from "@/composables/useFavorites";
import { useOpenFavorite } from "@/composables/useOpenFavorite";
import { toast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const { target, position, close } = useFavoriteMenu();
const { favorites, isNotify, toggleNotify, isPinned, togglePin, removeFavorite } = useFavorites();
const { openFavorite } = useOpenFavorite();
const menu = ref<HTMLElement | null>(null);
const left = ref(0);
const top = ref(0);

const matches = (f: { channel: string; platform: string; iframeUrl?: string }) => {
  const value = target.value;
  if (!value || f.platform !== value.platform) return false;
  if (value.platform === "custom" && (value.iframeUrl || f.iframeUrl))
    return f.iframeUrl === (value.iframeUrl || "");
  return (
    f.channel.replace(/^@+/, "").toLowerCase() === value.channel.replace(/^@+/, "").toLowerCase()
  );
};
const isFavorite = computed(() => favorites.value.some(matches));
/** Live alerts exist for Twitch and Kick channels only. */
const canNotify = computed(
  () => target.value?.platform === "twitch" || target.value?.platform === "kick"
);
const notifying = computed(() =>
  target.value
    ? isNotify(target.value.channel, target.value.platform, target.value.iframeUrl)
    : false
);
const pinned = computed(() =>
  target.value
    ? isPinned(target.value.channel, target.value.platform, target.value.iframeUrl)
    : false
);
const address = computed(() => {
  const value = target.value;
  if (!value) return "";
  if (value.platform === "custom") return value.iframeUrl || value.siteUrl || "";
  const handle = value.channel.replace(/^@+/, "");
  if (value.platform === "twitch") return `https://www.twitch.tv/${handle}`;
  if (value.platform === "kick") return `https://kick.com/${handle}`;
  return `https://www.youtube.com/@${handle}`;
});
const name = computed(() => target.value?.displayName || target.value?.channel || "");

// Keep the menu inside the window.
watch(target, async (value) => {
  if (!value) return;
  left.value = position.value.x;
  top.value = position.value.y;
  await nextTick();
  const box = menu.value?.getBoundingClientRect();
  if (!box) return;
  left.value = Math.max(4, Math.min(position.value.x, window.innerWidth - box.width - 4));
  top.value = Math.max(4, Math.min(position.value.y, window.innerHeight - box.height - 4));
});

const run = (action: () => void) => {
  action();
  close();
};

const open = () => {
  const value = target.value;
  if (value) void openFavorite(value);
};
const toggleAlerts = () => {
  const channel = target.value;
  if (!channel) return;
  const on = toggleNotify(
    channel.channel,
    channel.platform,
    channel.iframeUrl,
    channel.displayName
  );
  toast.success(t(on ? "alerts.enabled" : "alerts.disabled", { channel: name.value }));
};
const togglePinned = () => {
  const channel = target.value;
  if (channel) togglePin(channel.channel, channel.platform, channel.iframeUrl);
};
const copyAddress = () => {
  const text = address.value;
  if (!text) return;
  void navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(t("favoritesPanel.copied")))
    .catch(() => {});
};
const remove = () => {
  const channel = target.value;
  if (channel) removeFavorite(channel.channel, channel.platform, channel.iframeUrl);
};

useEventListener(window, "pointerdown", (event: PointerEvent) => {
  if (target.value && !menu.value?.contains(event.target as Node)) close();
});
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape") close();
});
useEventListener(window, "blur", close);
useEventListener(window, "resize", close);

const item =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none";
</script>

<template>
  <!-- role="menu" lets the native stream tiles be cut out beneath it (see useBrowserTiles). -->
  <div
    v-if="target"
    ref="menu"
    role="menu"
    data-testid="favorite-menu"
    :aria-label="name"
    class="pointer-events-auto fixed z-[60] min-w-48 rounded-lg border border-[#262930] bg-[#14161a] p-1 text-sm text-gray-200 shadow-xl"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @contextmenu.prevent
    @pointerdown.stop
    @mousedown.prevent
  >
    <button
      type="button"
      role="menuitem"
      data-testid="favorite-menu-open"
      :class="item"
      @click="run(open)"
    >
      <Play class="size-4 shrink-0" aria-hidden="true" />
      {{ $t("favoritesPanel.open") }}
    </button>
    <button
      v-if="isFavorite"
      type="button"
      role="menuitem"
      data-testid="favorite-menu-pin"
      :class="item"
      @click="run(togglePinned)"
    >
      <component :is="pinned ? PinOff : Pin" class="size-4 shrink-0" aria-hidden="true" />
      {{ pinned ? $t("favoritesPanel.unpin") : $t("favoritesPanel.pin") }}
    </button>
    <button
      v-if="canNotify"
      type="button"
      role="menuitem"
      data-testid="favorite-menu-notify"
      :class="item"
      @click="run(toggleAlerts)"
    >
      <component :is="notifying ? BellOff : Bell" class="size-4 shrink-0" aria-hidden="true" />
      {{ notifying ? $t("alerts.disable") : $t("alerts.enable") }}
    </button>
    <button
      v-if="address"
      type="button"
      role="menuitem"
      data-testid="favorite-menu-copy"
      :class="item"
      @click="run(copyAddress)"
    >
      <Copy class="size-4 shrink-0" aria-hidden="true" />
      {{ $t("favoritesPanel.copyAddress") }}
    </button>
    <button
      v-if="isFavorite"
      type="button"
      role="menuitem"
      data-testid="favorite-menu-remove"
      :class="[item, 'text-red-300']"
      @click="run(remove)"
    >
      <Trash2 class="size-4 shrink-0" aria-hidden="true" />
      {{ $t("favoritesPanel.remove") }}
    </button>
  </div>
</template>
