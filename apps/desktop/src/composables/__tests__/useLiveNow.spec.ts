import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, type EffectScope, type Ref } from "vue";
import { useLiveNow } from "../useLiveNow";
import type { ChannelSearchResult } from "../useChannelSearch";
import type { DirectoryEntry } from "@/lib/liveDirectory";

const searches: Record<string, Ref<ChannelSearchResult[]>> = {};
const fetchPage = vi.fn();
const fetchCategory = vi.fn();
vi.mock("@/lib/liveDirectory", () => ({
  directoryPage: (...args: unknown[]) => fetchPage(...args),
  categoryPage: (...args: unknown[]) => fetchCategory(...args),
}));
vi.mock("../useLiveStatus", () => ({ useLiveStatus: () => ({ getStatus: () => null }) }));
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
  platform: "twitch" | "kick" | "youtube" = "twitch"
): DirectoryEntry => ({
  channel,
  platform,
  title: `${channel} live`,
  category: "Music",
  viewerCount: 10,
});
const flush = async () => {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
};

describe("Live now discovery", () => {
  let scope: EffectScope;
  let sut: ReturnType<typeof useLiveNow>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    fetchPage.mockResolvedValue({ items: [], cursor: undefined });
    fetchCategory.mockResolvedValue({ items: [] });
    scope = effectScope();
    scope.run(() => {
      sut = useLiveNow();
    });
  });
  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
  });

  it("keeps independent provider results and filters by platform", async () => {
    // Arrange
    fetchPage.mockImplementation((p: string) =>
      Promise.resolve({ items: [stream(p, p as "twitch")], cursor: "next" })
    );
    // Act
    await sut.refresh();
    // Assert
    expect(sut.results.value.map((s) => s.channel)).toEqual(["twitch", "kick", "youtube"]);
    expect(sut.pages.twitch.cursor).toBe("next");
    expect(sut.pages.kick.cursor).toBe("next");
  });
  it("searches feed titles and separates offline remote results", () => {
    // Arrange
    sut.pages.twitch.items = [stream("one")];
    searches.twitch?.value.push(
      { channel: "online", platform: "twitch", isLive: true },
      { channel: "offline", platform: "twitch", isLive: false }
    );
    // Act
    sut.loadedQuery.value = "live";
    // Assert
    expect(sut.results.value.map((s) => s.channel)).toEqual(["one"]);
    expect(sut.channelResults.value.map((s) => s.status)).toEqual(["live", "offline"]);
  });
  it("expands results in batches and fetches further pages even with zero matches", async () => {
    // Arrange
    sut.pages.twitch.items = Array.from({ length: 40 }, (_, i) => stream(`channel${i}`));
    sut.pages.twitch.cursor = "next";
    sut.loadedQuery.value = "absent";
    fetchPage.mockResolvedValue({ items: [stream("absent")], cursor: "last" });
    // Act
    await sut.loadMore();
    // Assert
    expect(fetchPage).toHaveBeenCalledWith("twitch", "next", undefined, [], "");
    expect(sut.results.value.map((s) => s.channel)).toContain("absent");
  });
  it("ignores a category response after the category was cleared", async () => {
    // Arrange
    let complete!: (value: unknown) => void;
    sut.platform.value = "twitch";
    await flush();
    fetchPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    sut.category.value = "Music";
    // Act
    sut.category.value = "";
    complete({ items: [stream("stale")] });
    await flush();
    // Assert
    expect(sut.results.value).toEqual([]);
  });
  it("reports refresh errors and supports retry without losing successful providers", async () => {
    // Arrange
    sut.pages.twitch.items = [stream("retained")];
    fetchPage.mockImplementation((p: string) =>
      p === "twitch"
        ? Promise.reject(Error("offline"))
        : Promise.resolve({ items: [stream(p, "kick")] })
    );
    // Act
    await sut.refresh();
    const failed = sut.failed.value;
    fetchPage.mockResolvedValue({ items: [stream("recovered")] });
    await sut.retry("twitch");
    // Assert
    expect(failed).toBe(true);
    expect(sut.pages.twitch.items.map((s) => s.channel)).toContain("retained");
    expect(sut.failed.value).toBe(false);
  });
  it("marks YouTube channel search results for resolution without claiming missing status is offline", () => {
    // Arrange
    searches.youtube?.value.push({
      channel: "Example",
      handle: "example",
      platform: "youtube",
      isLive: undefined,
    });
    // Act
    const result = sut.channelResults.value[0];
    // Assert
    expect(result).toMatchObject({ channel: "example", resolveChannel: true, status: "unknown" });
  });
  it("deduplicates broadcasts by video ID, and rejects repeated cursors", async () => {
    // Arrange
    sut.platform.value = "youtube";
    await flush();
    sut.pages.youtube.items = [stream("videoA", "youtube")];
    sut.pages.youtube.cursor = "next";
    sut.pages.youtube.exhausted = false;
    fetchPage.mockResolvedValue({ items: [stream("videoB", "youtube")], cursor: "next" });
    // Act
    await sut.loadMore();
    // Assert
    expect(sut.pages.youtube.error).toBe(true);
    expect(sut.pages.youtube.items).toHaveLength(1);
  });
  it("refresh preserves query, category, tags and appended pages", async () => {
    // Arrange
    sut.platform.value = "twitch";
    sut.tags.value = ["English"];
    sut.category.value = "Music";
    sut.query.value = "music";
    await vi.advanceTimersByTimeAsync(300);
    sut.pages.twitch.items = [stream("deep-page")];
    sut.pages.twitch.cursor = "deep";
    fetchPage.mockResolvedValue({ items: [stream("fresh")], cursor: "first" });
    // Act
    await sut.refresh();
    // Assert
    expect(sut.query.value).toBe("music");
    expect(sut.category.value).toBe("Music");
    expect(sut.tags.value).toEqual(["English"]);
    expect(sut.pages.twitch.items.map((s) => s.channel)).toEqual(["fresh", "deep-page"]);
    expect(sut.pages.twitch.cursor).toBe("deep");
  });
  it("ignores category discovery completing after refresh", async () => {
    // Arrange
    let complete!: (value: unknown) => void;
    fetchCategory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    sut.platform.value = "twitch";
    await vi.advanceTimersByTimeAsync(300);
    // Act
    await sut.refresh();
    complete({ items: [{ id: "stale", name: "Stale" }] });
    await flush();
    // Assert
    expect(sut.categories.value).toEqual([]);
    expect(sut.categoryLoading.value).toBe(false);
  });
  it("keeps simultaneous YouTube broadcasts with the same channel identity", async () => {
    // Arrange
    sut.platform.value = "youtube";
    await flush();
    fetchPage.mockResolvedValue({
      items: [
        { ...stream("videoA", "youtube"), handle: "channel" },
        { ...stream("videoB", "youtube"), handle: "channel" },
      ],
    });
    // Act
    await sut.refresh();
    // Assert
    expect(sut.results.value.map((s) => s.channel)).toEqual(["videoA", "videoB"]);
    expect(sut.results.value.map((s) => s.handle)).toEqual(["channel", "channel"]);
  });
  it("ignores a late directory response after a query change", async () => {
    // Arrange
    sut.platform.value = "twitch";
    await flush();
    let complete!: (value: unknown) => void;
    fetchPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    sut.query.value = "old";
    await vi.advanceTimersByTimeAsync(300);
    // Act
    sut.query.value = "new";
    await vi.advanceTimersByTimeAsync(300);
    complete({ items: [stream("old-query")] });
    await flush();
    // Assert
    expect(sut.results.value).toEqual([]);
  });
  it("does not let the initial category debounce replace appended category pages", async () => {
    // Arrange
    sut.platform.value = "twitch";
    fetchCategory
      .mockResolvedValueOnce({ items: [{ id: "one", name: "One" }], cursor: "next" })
      .mockResolvedValueOnce({ items: [{ id: "two", name: "Two" }] });
    // Act
    await sut.loadCategories();
    await sut.loadCategories(true);
    await vi.advanceTimersByTimeAsync(300);
    // Assert
    expect(fetchCategory).toHaveBeenCalledTimes(2);
    expect(sut.categories.value.map((item) => item.id)).toEqual(["one", "two"]);
  });
  it("saves a reusable Twitch tag selection from loaded streams", () => {
    // Arrange
    sut.platform.value = "twitch";
    sut.loadedTags.value = ["ADHD", "Comedy"];
    // Act
    sut.saveFilter();
    // Assert
    expect(sut.saved.value[0]).toMatchObject({
      provider: "twitch",
      tags: [],
      loadedTags: ["ADHD", "Comedy"],
      label: "ADHD, Comedy",
    });
  });
});
