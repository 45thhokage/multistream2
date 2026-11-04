import { computed, ref, watch } from "vue";
import { useChannelSearch } from "./useChannelSearch";
import { useLiveStatus, type SuggestedStream } from "./useLiveStatus";

export const LIVE_PLATFORMS = ["twitch", "kick", "youtube"] as const;
export type LivePlatformFilter = "all" | (typeof LIVE_PLATFORMS)[number];
export interface LiveEntry extends SuggestedStream {
  resolveChannel?: boolean;
}

export function useLiveNow() {
  const query = ref("");
  const platform = ref<LivePlatformFilter>("all");
  const category = ref("");
  const visibleCount = ref(24);
  const extraStreams = ref<SuggestedStream[]>([]);
  const categoryLoading = ref(false);
  const failed = ref(false);
  let categoryRequest = 0;
  const {
    suggestedStreams,
    isLoadingSuggestions,
    isLoadingMoreSuggestions,
    refreshSuggestions,
    fetchStreamsForCategory,
    getStatus,
  } = useLiveStatus();
  const { search } = useChannelSearch();
  const sessions = LIVE_PLATFORMS.map((id) =>
    search(
      () =>
        (platform.value === "all" || platform.value === id) && query.value.trim().length >= 2
          ? query.value
          : "",
      id
    )
  );
  const searching = computed(() => sessions.some((session) => session.isLoading.value));
  const feed = computed(() => {
    const entries = new Map<string, LiveEntry>();
    for (const stream of [...suggestedStreams.value, ...extraStreams.value]) {
      entries.set(`${stream.platform}:${stream.channel.toLowerCase()}`, stream);
    }
    return [...entries.values()];
  });
  const categories = computed(() =>
    [
      ...new Set(
        feed.value
          .filter((stream) => platform.value === "all" || stream.platform === platform.value)
          .map((stream) => stream.category)
          .filter(Boolean)
      ),
    ].toSorted()
  );
  const results = computed(() => {
    const text = query.value.trim().toLowerCase();
    const entries = new Map<string, LiveEntry>();
    for (const stream of feed.value) {
      if (
        text &&
        ![stream.channel, stream.displayName, stream.title, stream.category, stream.handle].some(
          (value) => value?.toLowerCase().includes(text)
        )
      )
        continue;
      entries.set(`${stream.platform}:${stream.channel.toLowerCase()}`, stream);
    }
    if (text.length >= 2) {
      for (const session of sessions) {
        for (const result of session.results.value) {
          if (!result.isLive) continue;
          const channel = result.handle || result.channel;
          const status = getStatus(channel, result.platform);
          const key = `${result.platform}:${(status?.videoId || channel).toLowerCase()}`;
          if (entries.has(key)) continue;
          entries.set(key, {
            channel: status?.videoId || channel,
            platform: result.platform,
            displayName: result.channel,
            handle: result.handle,
            title: status?.title || "",
            category: status?.category || result.category || "",
            viewerCount: status?.viewerCount ?? 0,
            thumbnail: status?.thumbnailUrl,
            resolveChannel: result.platform === "youtube" && !status?.videoId,
          });
        }
      }
    }
    return [...entries.values()]
      .filter(
        (stream) =>
          (platform.value === "all" || stream.platform === platform.value) &&
          (!category.value || stream.category === category.value)
      )
      .toSorted((a, b) => b.viewerCount - a.viewerCount);
  });
  const visibleResults = computed(() => results.value.slice(0, visibleCount.value));
  watch([query, platform, category], () => {
    visibleCount.value = 24;
  });
  watch(platform, () => {
    category.value = "";
  });
  watch(category, async (value) => {
    const request = ++categoryRequest;
    if (!value) {
      categoryLoading.value = false;
      return;
    }
    failed.value = false;
    categoryLoading.value = true;
    try {
      const streams = await fetchStreamsForCategory(value);
      if (request === categoryRequest) extraStreams.value = streams;
    } catch {
      if (request === categoryRequest) failed.value = true;
    } finally {
      if (request === categoryRequest) categoryLoading.value = false;
    }
  });
  const refresh = async () => {
    failed.value = false;
    extraStreams.value = [];
    category.value = "";
    try {
      await refreshSuggestions();
    } catch {
      failed.value = true;
    }
  };
  return {
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
  };
}
