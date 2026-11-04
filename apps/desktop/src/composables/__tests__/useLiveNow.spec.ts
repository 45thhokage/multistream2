import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, type EffectScope, type Ref } from "vue";
import { useLiveNow } from "../useLiveNow";
import type { SuggestedStream } from "../useLiveStatus";
import type { ChannelSearchResult } from "../useChannelSearch";

const feed = ref<SuggestedStream[]>([]);
const searches: Record<string, Ref<ChannelSearchResult[]>> = {};
const fetchCategory = vi.fn();
const refresh = vi.fn();
vi.mock("../useLiveStatus", () => ({
  useLiveStatus: () => ({
    suggestedStreams: feed,
    isLoadingSuggestions: ref(false),
    isLoadingMoreSuggestions: ref(false),
    refreshSuggestions: refresh,
    fetchStreamsForCategory: fetchCategory,
    getStatus: () => null,
  }),
}));
vi.mock("../useChannelSearch", () => ({
  useChannelSearch: () => ({
    search: (_query: unknown, platform: string) => {
      const results = ref<ChannelSearchResult[]>([]);
      searches[platform] = results;
      return { results, isLoading: ref(false) };
    },
  }),
}));

const stream = (
  channel: string,
  platform: "twitch" | "kick" = "twitch",
  viewerCount = 10
): SuggestedStream => ({
  channel,
  platform,
  viewerCount,
  title: `${channel} live`,
  category: "Music",
});

describe("Live now discovery", () => {
  let scope: EffectScope;
  let sut: ReturnType<typeof useLiveNow>;
  beforeEach(() => {
    vi.clearAllMocks();
    feed.value = [];
    scope = effectScope();
    scope.run(() => {
      sut = useLiveNow();
    });
  });
  afterEach(() => scope.stop());

  it("sorts live streams by viewers and filters by platform", () => {
    // Arrange
    feed.value = [stream("one"), stream("two", "kick", 50)];
    // Act
    const initial = sut.results.value.map((item) => item.channel);
    sut.platform.value = "twitch";
    // Assert
    expect(initial).toEqual(["two", "one"]);
    expect(sut.results.value.map((item) => item.channel)).toEqual(["one"]);
  });

  it("searches feed titles and excludes offline remote results", () => {
    // Arrange
    feed.value = [stream("one")];
    searches.twitch?.value.push(
      { channel: "online", platform: "twitch", isLive: true },
      { channel: "offline", platform: "twitch", isLive: false }
    );
    // Act
    sut.query.value = "live";
    // Assert
    expect(sut.results.value.map((item) => item.channel)).toEqual(["one", "online"]);
  });

  it("expands results in batches and resets the batch when filters change", async () => {
    // Arrange
    feed.value = Array.from({ length: 40 }, (_, i) => stream(`channel${i}`));
    expect(sut.visibleResults.value).toHaveLength(24);
    // Act
    sut.visibleCount.value += 24;
    const expanded = sut.visibleResults.value.length;
    sut.query.value = "channel";
    await nextTick();
    // Assert
    expect(expanded).toBe(40);
    expect(sut.visibleResults.value).toHaveLength(24);
  });

  it("ignores a category response after the category was cleared", async () => {
    // Arrange
    let complete: ((value: SuggestedStream[]) => void) | undefined;
    fetchCategory.mockImplementationOnce(
      () =>
        new Promise<SuggestedStream[]>((resolve) => {
          complete = resolve;
        })
    );
    sut.category.value = "Music";
    await nextTick();
    // Act
    sut.category.value = "";
    await nextTick();
    complete?.([stream("stale")]);
    await nextTick();
    // Assert
    expect(sut.results.value).toEqual([]);
    expect(sut.categoryLoading.value).toBe(false);
  });

  it("reports refresh errors and supports retry", async () => {
    // Arrange
    refresh.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    // Act
    await sut.refresh();
    const failed = sut.failed.value;
    await sut.refresh();
    // Assert
    expect(failed).toBe(true);
    expect(sut.failed.value).toBe(false);
  });

  it("marks live YouTube channel search results for video resolution", () => {
    // Arrange
    searches.youtube?.value.push({
      channel: "Example",
      handle: "example",
      platform: "youtube",
      isLive: true,
    });
    // Act
    sut.query.value = "example";
    // Assert
    expect(sut.results.value[0]).toMatchObject({
      platform: "youtube",
      channel: "example",
      resolveChannel: true,
    });
  });
});
