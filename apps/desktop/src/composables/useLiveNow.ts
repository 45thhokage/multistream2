import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { useChannelSearch } from "./useChannelSearch";
import { useLiveStatus } from "./useLiveStatus";
import {
  categoryPage,
  directoryPage,
  type DirectoryEntry,
  type DirectoryCategory,
  type DirectoryProvider,
} from "@/lib/liveDirectory";

export const LIVE_PLATFORMS = ["twitch", "kick", "youtube"] as const;
export type LivePlatformFilter = "all" | DirectoryProvider;
export type LiveEntry = DirectoryEntry;
const identity = (s: LiveEntry) =>
  `${s.platform}:${s.platform === "youtube" ? s.channel : s.channel.toLowerCase()}`;
const merge = (old: LiveEntry[], items: LiveEntry[]) => [
  ...new Map([...old, ...items].map((s) => [identity(s), s])).values(),
];

export function useLiveNow() {
  const query = useStorage("live-now-query", "");
  const loadedQuery = useStorage("live-now-loaded-query", "");
  const loadedTags = ref<string[]>([]);
  const platform = useStorage<LivePlatformFilter>("live-now-provider", "all");
  const category = useStorage("live-now-category", "");
  const categoryName = useStorage("live-now-category-name", "");
  const tags = useStorage<string[]>("live-now-tags", []);
  const visibleCount = ref(24);
  const categoryQuery = ref("");
  const categories = ref<DirectoryCategory[]>([]);
  const categoryCursor = ref<string>();
  const categoryLoading = ref(false);
  const categoryError = ref(false);
  const categorySeen = new Set<string>();
  let categoryRevision = 0;
  let revision = 0;
  let disposed = false;
  const pages = reactive(
    Object.fromEntries(
      LIVE_PLATFORMS.map((p) => [
        p,
        {
          items: [] as LiveEntry[],
          head: [] as string[],
          errorMessage: "",
          cursor: undefined as string | undefined,
          busy: false,
          error: false,
          exhausted: false,
          seen: new Set<string>(),
        },
      ])
    ) as Record<
      DirectoryProvider,
      {
        items: LiveEntry[];
        head: string[];
        errorMessage: string;
        cursor?: string;
        busy: boolean;
        error: boolean;
        exhausted: boolean;
        seen: Set<string>;
      }
    >
  );
  const selected = computed(() =>
    platform.value === "all" ? [...LIVE_PLATFORMS] : [platform.value]
  );
  const { getStatus } = useLiveStatus();
  const { search } = useChannelSearch();
  const sessions = LIVE_PLATFORMS.map((id) =>
    search(
      () =>
        selected.value.includes(id) &&
        query.value.trim().length >= 2 &&
        !query.value.includes("://")
          ? query.value
          : "",
      id
    )
  );
  const channelResults = computed<LiveEntry[]>(() =>
    sessions
      .flatMap((session) =>
        session.results.value.map((result): LiveEntry => {
          const channel = result.identity || result.handle || result.channel;
          const status = getStatus(channel, result.platform);
          return {
            channel,
            platform: result.platform as DirectoryProvider,
            displayName: result.channel,
            handle: result.handle,
            title: "",
            category: result.category || "",
            viewerCount: status?.viewerCount,
            status: status
              ? status.isLive
                ? "live"
                : "offline"
              : result.isLive === undefined
                ? "unknown"
                : result.isLive
                  ? "live"
                  : "offline",
            resolveChannel: result.platform === "youtube",
          };
        })
      )
      .filter((s) => selected.value.includes(s.platform))
  );
  const searchFailed = computed(() => sessions.some((s) => s.error?.value));
  const searching = computed(() => sessions.some((s) => s.isLoading.value));
  const feed = computed(() => selected.value.flatMap((p) => pages[p].items));
  const availableTags = computed(() =>
    [...new Set(feed.value.flatMap((s) => s.tags || []))].toSorted()
  );
  const results = computed(() => {
    const text = loadedQuery.value.trim().toLowerCase();
    return feed.value.filter(
      (s) =>
        (!text ||
          [s.channel, s.displayName, s.title].some((v) => v?.toLowerCase().includes(text))) &&
        loadedTags.value.every((t) => s.tags?.some((tag) => tag.toLowerCase() === t.toLowerCase()))
    );
  });
  const visibleResults = computed(() => results.value.slice(0, visibleCount.value));
  const isLoadingSuggestions = computed(() => selected.value.some((p) => pages[p].busy));
  const failed = computed(() => selected.value.some((p) => pages[p].error));
  const hasMore = computed(
    () =>
      results.value.length > visibleCount.value || selected.value.some((p) => !pages[p].exhausted)
  );
  async function fetchPage(provider: DirectoryProvider, refresh = false) {
    const state = pages[provider];
    if (state.busy || (!refresh && state.exhausted)) return;
    const request = revision;
    const cursor = refresh ? undefined : state.cursor;
    state.busy = true;
    try {
      const page = await directoryPage(
        provider,
        cursor,
        provider === platform.value ? category.value : undefined,
        provider === "twitch" ? tags.value : [],
        query.value.trim()
      );
      if (disposed || request !== revision) return;
      if (page.cursor && (page.cursor === cursor || (!refresh && state.seen.has(page.cursor))))
        throw new Error("Repeated cursor");
      const newItems = page.items.filter(
        (s) => !state.items.some((old) => identity(old) === identity(s))
      );
      if (!refresh && cursor && page.items.length && !newItems.length)
        throw new Error("Repeated page");
      // Keep appended pages while replacing the previously loaded first page.
      state.items = !cursor
        ? merge(
            page.items,
            state.items.filter(
              (s) =>
                !state.head.includes(identity(s)) &&
                !page.items.some((f) => identity(f) === identity(s))
            )
          )
        : merge(state.items, page.items);
      if (!cursor) state.head = page.items.map(identity);
      if (!refresh || !state.cursor) {
        state.cursor = page.cursor;
        state.exhausted = !page.cursor;
      }
      if (page.cursor) state.seen.add(page.cursor);
      state.error = false;
      state.errorMessage = "";
    } catch (error) {
      if (request === revision && !disposed) {
        state.error = true;
        state.errorMessage = String(error);
      }
    } finally {
      if (request === revision && !disposed) state.busy = false;
    }
  }
  const refresh = async () => {
    ++categoryRevision;
    categoryLoading.value = false;
    await Promise.all(selected.value.map((p) => fetchPage(p, true)));
  };
  const loadMore = async () => {
    visibleCount.value += 24;
    await Promise.all(selected.value.filter((p) => !pages[p].exhausted).map((p) => fetchPage(p)));
  };
  const retry = async (p: DirectoryProvider) => fetchPage(p, !pages[p].cursor);
  const reset = () => {
    ++revision;
    for (const p of LIVE_PLATFORMS)
      Object.assign(pages[p], {
        items: [],
        head: [],
        errorMessage: "",
        cursor: undefined,
        busy: false,
        error: false,
        exhausted: false,
        seen: new Set<string>(),
      });
    visibleCount.value = 24;
  };
  const submitSearch = () => {
    clearTimeout(searchTimer);
    sessions.forEach((s) => s.submit?.());
    void refresh();
  };
  watch(
    [platform, category, tags],
    () => {
      reset();
      void refresh();
    },
    { deep: true, flush: "sync" }
  );
  watch(
    platform,
    () => {
      category.value = "";
      categoryName.value = "";
      loadedTags.value = [];
      categoryQuery.value = "";
      categories.value = [];
    },
    { flush: "sync" }
  );
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  watch(
    query,
    () => {
      reset();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void refresh(), 300);
    },
    { flush: "sync" }
  );
  async function loadCategories(more = false) {
    if (platform.value !== "twitch" && platform.value !== "kick") return;
    if (more && (categoryLoading.value || !categoryCursor.value)) return;
    clearTimeout(categoryTimer);
    if (!more) categorySeen.clear();
    const request = ++categoryRevision;
    const provider = platform.value;
    categoryLoading.value = true;
    categoryError.value = false;
    try {
      const page = await categoryPage(
        provider,
        categoryQuery.value,
        more ? categoryCursor.value : undefined
      );
      if (request !== categoryRevision || disposed) return;
      if (more && page.cursor && categorySeen.has(page.cursor))
        throw new Error("Repeated category cursor");
      if (page.cursor) categorySeen.add(page.cursor);
      categories.value = [
        ...new Map(
          [...(more ? categories.value : []), ...page.items].map((c) => [c.id, c])
        ).values(),
      ];
      categoryCursor.value = page.cursor;
    } catch {
      if (request === categoryRevision) categoryError.value = true;
    } finally {
      if (request === categoryRevision) categoryLoading.value = false;
    }
  }
  let categoryTimer: ReturnType<typeof setTimeout> | undefined;
  watch(
    [categoryQuery, platform],
    () => {
      ++categoryRevision;
      categorySeen.clear();
      categories.value = [];
      categoryCursor.value = undefined;
      clearTimeout(categoryTimer);
      categoryTimer = setTimeout(() => void loadCategories(), 300);
    },
    { flush: "sync", immediate: true }
  );
  watch(
    [loadedQuery, loadedTags],
    () => {
      visibleCount.value = 24;
    },
    { deep: true }
  );
  const saved = useStorage<
    {
      provider: "twitch" | "kick";
      tags: string[];
      loadedTags?: string[];
      category: string;
      label: string;
    }[]
  >("live-now-filters", []);
  function saveFilter() {
    if (platform.value !== "twitch" && platform.value !== "kick") return;
    const value = {
      provider: platform.value,
      tags: [...tags.value],
      loadedTags: platform.value === "twitch" ? [...loadedTags.value] : [],
      category: category.value,
      label:
        platform.value === "twitch"
          ? [...new Set([...tags.value, ...loadedTags.value])].join(", ")
          : categories.value.find((c) => c.id === category.value)?.name || category.value,
    };
    if (value.label && !saved.value.some((s) => JSON.stringify(s) === JSON.stringify(value)))
      saved.value.push(value);
  }
  onScopeDispose(() => {
    disposed = true;
    ++revision;
    ++categoryRevision;
    clearTimeout(searchTimer);
    clearTimeout(categoryTimer);
  });
  return {
    query,
    loadedQuery,
    loadedTags,
    platform,
    category,
    categoryName,
    categories,
    categoryQuery,
    categoryCursor,
    categoryError,
    loadCategories,
    tags,
    availableTags,
    searchFailed,
    saved,
    saveFilter,
    channelResults,
    pages,
    results,
    visibleResults,
    visibleCount,
    searching,
    categoryLoading,
    failed,
    isLoadingSuggestions,
    isLoadingMoreSuggestions: isLoadingSuggestions,
    refresh,
    loadMore,
    hasMore,
    retry,
    submitSearch,
  };
}
