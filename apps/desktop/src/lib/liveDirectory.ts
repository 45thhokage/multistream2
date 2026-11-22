import { invoke } from "@tauri-apps/api/core";
import { httpGet, httpPost } from "./http";
import { API_CONFIG } from "@/config/api";
import type { SuggestedStream } from "@/composables/useLiveStatus";

export type DirectoryProvider = "twitch" | "kick" | "youtube";
export interface DirectoryEntry extends Omit<SuggestedStream, "viewerCount"> {
  platform: DirectoryProvider;
  viewerCount?: number;
  tags?: string[];
  status?: "live" | "offline" | "unknown";
  resolveChannel?: boolean;
}
export interface DirectoryPage<T> {
  items: T[];
  cursor?: string;
}
export interface DirectoryCategory {
  id: string;
  name: string;
  artwork?: string;
  viewerCount?: number;
}

async function json(response: Response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function gql(query: string) {
  const data = await json(
    await httpPost(API_CONFIG.twitch.gqlUrl, JSON.stringify({ query }), {
      "Client-Id": API_CONFIG.twitch.clientId,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Content-Type": "application/json",
    })
  );
  if (data.errors?.length)
    throw new Error(data.errors.map((e: { message: string }) => e.message).join("; "));
  if (!data.data) throw new Error("Missing Twitch response");
  return data.data;
}
function next(connection: any): string | undefined {
  return connection.pageInfo?.hasNextPage ? connection.edges.at(-1)?.cursor : undefined;
}
export async function directoryPage(
  provider: DirectoryProvider,
  cursor?: string,
  category?: string,
  tags: string[] = [],
  query = ""
): Promise<DirectoryPage<DirectoryEntry>> {
  if (provider === "youtube")
    return invoke("youtube_search_live", { query, cursor: cursor ?? null });
  if (provider === "twitch") {
    const connection = `streams(first: 30, ${cursor ? `after: ${JSON.stringify(cursor)},` : ""} options: {sort: VIEWER_COUNT, freeformTags: ${JSON.stringify(tags)}}) {
      edges { cursor node { title viewersCount freeformTags { name } broadcaster { login displayName } game { displayName } previewImageURL(width: 640, height: 360) } } pageInfo { hasNextPage }
    }`;
    const data = await gql(
      category ? `{ game(id: ${JSON.stringify(category)}) { ${connection} } }` : `{ ${connection} }`
    );
    const streams = category ? data.game?.streams : data.streams;
    if (!Array.isArray(streams?.edges)) throw new Error("Missing Twitch streams");
    return {
      cursor: next(streams),
      items: streams.edges.map(({ node }: any) => ({
        channel: node.broadcaster.login,
        displayName: node.broadcaster.displayName,
        platform: provider,
        title: node.title,
        category: node.game?.displayName ?? "",
        viewerCount: node.viewersCount ?? undefined,
        thumbnail: node.previewImageURL,
        tags: node.freeformTags?.map((t: any) => t.name) ?? [],
        status: "live",
      })),
    };
  }
  const params = new URLSearchParams({ limit: "30", page: cursor || "1", sort: "desc" });
  if (category) params.set("subcategory", category);
  const data = await json(await httpGet(`https://kick.com/stream/livestreams/en?${params}`));
  if (!Array.isArray(data.data)) throw new Error("Missing Kick streams");
  return {
    cursor: data.next_page_url ? String(Number(cursor || 1) + 1) : undefined,
    items: data.data
      .filter((s: any) => s.channel?.slug && s.is_live !== false)
      .map((s: any) => ({
        channel: s.channel.slug,
        displayName: s.channel.user?.username,
        platform: provider,
        title: s.session_title ?? "",
        category: s.categories?.[0]?.name ?? "",
        viewerCount: s.viewer_count ?? undefined,
        thumbnail: s.thumbnail?.src,
        status: "live",
      })),
  };
}
export async function categoryPage(
  provider: "twitch" | "kick",
  query: string,
  cursor?: string
): Promise<DirectoryPage<DirectoryCategory>> {
  if (provider === "kick") {
    if (query.trim().length < 3) return { items: [] };
    const data = await json(
      await httpGet(`https://kick.com/api/search?searched_word=${encodeURIComponent(query.trim())}`)
    );
    if (!Array.isArray(data.categories)) throw new Error("Missing Kick categories");
    return {
      items: data.categories
        .filter((c: any) => c.slug && c.name)
        .map((c: any) => ({ id: c.slug, name: c.name })),
    };
  }
  const fields = "id name displayName viewersCount boxArtURL(width: 104, height: 144)";
  const data = await gql(
    query.trim()
      ? `{ searchFor(userQuery: ${JSON.stringify(query.trim())}, platform: "web", target: {index: GAME}) { games { items { ... on Game { ${fields} } } } } }`
      : `{ games(first: 30, ${cursor ? `after: ${JSON.stringify(cursor)},` : ""} options: {sort: VIEWER_COUNT}) { edges { cursor node { ${fields} } } pageInfo { hasNextPage } } }`
  );
  const nodes = query.trim()
    ? data.searchFor?.games?.items
    : data.games?.edges?.map((e: any) => e.node);
  if (!Array.isArray(nodes)) throw new Error("Missing Twitch categories");
  return {
    cursor: data.games ? next(data.games) : undefined,
    items: nodes.map((c: any) => ({
      id: c.id,
      name: c.displayName || c.name,
      artwork: c.boxArtURL,
      viewerCount: c.viewersCount ?? undefined,
    })),
  };
}
