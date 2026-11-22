/**
 * How the sidebar's Favorites list is arranged and narrowed (adapted from Multi Worldview's
 * core/library/favoriteView.ts, MIT).
 *
 * A flat list in the order things were starred stops working past a dozen entries: whoever is
 * live is buried among everyone who is not, and a channel can only be found by reading the whole
 * list. So:
 *  - the list is split into Pinned (the user's own top), Live now (most watched first) and
 *    Others (the order things were starred in);
 *  - a chip row narrows it to live channels or to one site, each chip saying how many it holds
 *    (a website starred more than five times gets its own chip rather than sharing Websites);
 *  - a search matches the name, the address and what a live channel is streaming.
 *
 * Kept out of the component so the rules can be tested without rendering.
 */
import type { FavoriteChannel } from "@/composables/useFavorites";
import type { LiveStatus } from "@/composables/useLiveStatus";

export interface FavoriteViewRow {
  favorite: FavoriteChannel;
  label: string;
  /** Live right now, by the live-status poller. */
  live: boolean;
  /** A channel that was checked and is not live (a website favorite never is). */
  offline: boolean;
  viewerCount?: number;
  /** What a live channel is streaming: its title, then its category. */
  detail?: string;
  /** The address the favorite opens (website and media favorites). */
  url?: string;
}

export type FavoriteSectionId = "pinned" | "live" | "others";

export interface FavoriteSection {
  id: FavoriteSectionId;
  rows: FavoriteViewRow[];
}

/** `all`, `live`, a site group (`twitch`, `kick`, `youtube`, `tiktok`, `web`, `other`), or `site:<host>`. */
export type FavoriteFilter = string;

export interface FavoriteChip {
  key: FavoriteFilter;
  count: number;
}

/** A website starred more than this many times gets its own chip. */
export const SITE_CHIP_MIN = 5;

const HOST_GROUPS: [RegExp, string][] = [
  [/(^|\.)twitch\.tv$/, "twitch"],
  [/(^|\.)kick\.com$/, "kick"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
];
const MEDIA_PATH = /\.(m3u8|mpd|mp4|webm|mkv|mov|m4v|flv)(\?|#|$)/i;
const GROUP_ORDER = ["twitch", "kick", "youtube", "tiktok", "web", "other"];

export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** The address a favorite opens: its page for a website, nothing for a channel. */
export function favoriteUrl(favorite: FavoriteChannel): string | undefined {
  return favorite.platform === "custom" ? favorite.iframeUrl || favorite.siteUrl : undefined;
}

/**
 * The site group a favorite is filtered under. The platform decides for channels; for a website
 * the address decides, so a TikTok profile starred from a website tile is filed under TikTok.
 */
export function favoriteSiteGroup(favorite: FavoriteChannel): string {
  if (favorite.platform !== "custom") return favorite.platform;
  const url = favoriteUrl(favorite);
  if (url && MEDIA_PATH.test(url)) return "other";
  const host = hostOf(url);
  const known = host ? HOST_GROUPS.find(([pattern]) => pattern.test(host)) : undefined;
  if (known) return known[1]!;
  return host ? "web" : "other";
}

export interface FavoriteViewOptions {
  filter?: FavoriteFilter;
  query?: string;
}

export interface FavoriteView {
  sections: FavoriteSection[];
  chips: FavoriteChip[];
  liveCount: number;
  matched: number;
}

export function favoriteView(
  favorites: readonly FavoriteChannel[],
  statusOf: (favorite: FavoriteChannel) => LiveStatus | null | undefined,
  options: FavoriteViewOptions = {}
): FavoriteView {
  const rows: FavoriteViewRow[] = favorites.map((favorite) => {
    const channel = favorite.platform !== "custom";
    const status = channel ? statusOf(favorite) : undefined;
    const live = status?.isLive === true;
    const name = (status?.displayName || favorite.displayName || favorite.channel).replace(
      /^@/,
      ""
    );
    return {
      favorite,
      label: name,
      live,
      offline: channel && !!status && !live,
      viewerCount: live ? status?.viewerCount : undefined,
      detail: live ? status?.title || status?.category || undefined : undefined,
      url: favoriteUrl(favorite),
    };
  });

  const liveCount = rows.filter((r) => r.live).length;

  const siteHost = (r: FavoriteViewRow) => hostOf(r.url).replace(/^www\./, "");
  const hostCounts = new Map<string, number>();
  for (const r of rows) {
    if (favoriteSiteGroup(r.favorite) !== "web") continue;
    const host = siteHost(r);
    if (host) hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }
  const ownChip = new Set(
    [...hostCounts].filter(([, n]) => n > SITE_CHIP_MIN).map(([host]) => host)
  );
  const groupOf = (r: FavoriteViewRow) => {
    const group = favoriteSiteGroup(r.favorite);
    if (group !== "web") return group;
    const host = siteHost(r);
    return ownChip.has(host) ? `site:${host}` : group;
  };

  const groupCounts = new Map<string, number>();
  for (const r of rows) {
    const group = groupOf(r);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }
  const chips: FavoriteChip[] = [{ key: "all", count: rows.length }];
  if (liveCount > 0) chips.push({ key: "live", count: liveCount });
  // One site only is nothing to choose between.
  if (groupCounts.size > 1) {
    const siteGroups = [...ownChip]
      .toSorted((a, b) => (hostCounts.get(b) ?? 0) - (hostCounts.get(a) ?? 0) || a.localeCompare(b))
      .map((host) => `site:${host}`);
    const order = [
      ...GROUP_ORDER.slice(0, GROUP_ORDER.indexOf("web")),
      ...siteGroups,
      "web",
      "other",
    ];
    for (const group of order) {
      const count = groupCounts.get(group);
      if (count) chips.push({ key: group, count });
    }
  }

  const filter = options.filter ?? "all";
  const q = options.query?.trim().toLowerCase() ?? "";
  const matching = rows.filter((r) => {
    if (filter === "live" && !r.live) return false;
    if (filter !== "all" && filter !== "live" && groupOf(r) !== filter) return false;
    if (!q) return true;
    return [r.label, r.favorite.channel, r.favorite.displayName, r.url, r.detail].some(
      (v) => v && v.toLowerCase().includes(q)
    );
  });

  const pinned = matching.filter((r) => r.favorite.pinned);
  const live = matching
    .filter((r) => !r.favorite.pinned && r.live)
    .toSorted((a, b) => (b.viewerCount ?? -1) - (a.viewerCount ?? -1));
  const others = matching.filter((r) => !r.favorite.pinned && !r.live);
  const sections: FavoriteSection[] = (
    [
      { id: "pinned", rows: pinned },
      { id: "live", rows: live },
      { id: "others", rows: others },
    ] as FavoriteSection[]
  ).filter((s) => s.rows.length > 0);
  return { sections, chips, liveCount, matched: matching.length };
}
