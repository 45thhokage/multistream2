import { describe, expect, it } from "vitest";
import type { FavoriteChannel } from "@/composables/useFavorites";
import type { LiveStatus } from "@/composables/useLiveStatus";
import { favoriteSiteGroup, favoriteView } from "../favoriteView";

let at = 0;
const channel = (
  name: string,
  platform: FavoriteChannel["platform"],
  extra = {}
): FavoriteChannel => ({
  channel: name,
  platform,
  addedAt: ++at,
  ...extra,
});
const site = (url: string, extra = {}): FavoriteChannel =>
  channel(new URL(url).hostname, "custom", { iframeUrl: url, ...extra });

const statuses: Record<string, LiveStatus> = {
  "twitch:alpha": { isLive: true, viewerCount: 372, title: "Speedruns" },
  "twitch:bravo": { isLive: false },
  "kick:charlie": { isLive: true, viewerCount: 1200 },
};
const statusOf = (f: FavoriteChannel) => statuses[`${f.platform}:${f.channel}`] ?? null;

describe("favoriteView", () => {
  it("splits favorites into Pinned, Live now (most watched first) and Others", () => {
    // Arrange
    const favorites = [
      channel("alpha", "twitch"),
      channel("bravo", "twitch"),
      channel("charlie", "kick"),
      channel("delta", "youtube", { pinned: true }),
    ];

    // Act
    const view = favoriteView(favorites, statusOf);

    // Assert
    expect(view.sections.map((s) => [s.id, s.rows.map((r) => r.favorite.channel)])).toEqual([
      ["pinned", ["delta"]],
      ["live", ["charlie", "alpha"]],
      ["others", ["bravo"]],
    ]);
    expect(view.liveCount).toBe(2);
    expect(view.sections[2]!.rows[0]!.offline).toBe(true);
  });

  it("offers a chip per platform, Live, and its own chip for a site starred more than 5 times", () => {
    // Arrange: six camsoda pages, one other site, two channels
    const favorites = [
      ...Array.from({ length: 6 }, (_, i) => site(`https://www.camsoda.com/model${i}`)),
      site("https://example.org/"),
      site("https://www.tiktok.com/@someone"),
      channel("alpha", "twitch"),
      channel("charlie", "kick"),
    ];

    // Act
    const view = favoriteView(favorites, statusOf);

    // Assert
    expect(view.chips).toEqual([
      { key: "all", count: 10 },
      { key: "live", count: 2 },
      { key: "twitch", count: 1 },
      { key: "kick", count: 1 },
      { key: "tiktok", count: 1 },
      { key: "site:camsoda.com", count: 6 },
      { key: "web", count: 1 },
    ]);
  });

  it("narrows by chip and by search over name, address and what a channel is streaming", () => {
    // Arrange
    const favorites = [
      channel("alpha", "twitch"),
      channel("charlie", "kick"),
      site("https://example.org/watch"),
    ];

    // Act
    const live = favoriteView(favorites, statusOf, { filter: "live" });
    const byTitle = favoriteView(favorites, statusOf, { query: "speedrun" });
    const byAddress = favoriteView(favorites, statusOf, { query: "example.org" });

    // Assert
    expect(live.matched).toBe(2);
    expect(byTitle.sections.flatMap((s) => s.rows.map((r) => r.favorite.channel))).toEqual([
      "alpha",
    ]);
    expect(byAddress.matched).toBe(1);
  });

  it("files a website favorite by its address: TikTok pages under TikTok, media links apart", () => {
    // Assert
    expect(favoriteSiteGroup(site("https://www.tiktok.com/@a"))).toBe("tiktok");
    expect(favoriteSiteGroup(site("https://cdn.example.org/live/index.m3u8"))).toBe("other");
    expect(favoriteSiteGroup(site("https://www.camsoda.com/a"))).toBe("web");
    expect(favoriteSiteGroup(channel("alpha", "twitch"))).toBe("twitch");
  });
});
