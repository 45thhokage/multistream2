function isRedgifsHost(hostname: string): boolean {
  return hostname === "redgifs.com" || hostname.endsWith(".redgifs.com");
}

function isInstagramHost(hostname: string): boolean {
  return hostname === "instagram.com" || hostname.endsWith(".instagram.com");
}

function isOfficialEmbedPlayer(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  if (host === "redgifs.com" || host.endsWith(".redgifs.com")) return path.startsWith("/ifr/");
  if (host === "instagram.com" || host.endsWith(".instagram.com"))
    return /\/embed(?:\/|$)/i.test(path);
  if (host === "player.vimeo.com") return true;
  return false;
}

export function normalizeCustomEmbedUrl(raw: string): string {
  const trimmed = raw.trim();
  const hadProtocol = /^https?:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hadProtocol ? trimmed : `https://${trimmed}`);
  } catch {
    return trimmed;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;

  const hostname = url.hostname.toLowerCase();

  if (isRedgifsHost(hostname)) {
    const match =
      url.pathname.match(/\/watch\/([^/?#]+)/i) ?? url.pathname.match(/\/ifr\/([^/?#]+)/i);
    if (match?.[1]) return `https://www.redgifs.com/ifr/${match[1]}`;
  }

  if (isInstagramHost(hostname)) {
    const match = url.pathname.match(/^\/(p|reel|reels)\/([^/?#]+)/i);
    if (match?.[1] && match?.[2]) {
      const kind = match[1].toLowerCase() === "p" ? "p" : "reel";
      return `https://www.instagram.com/${kind}/${match[2]}/embed`;
    }
  }

  return hadProtocol ? trimmed : url.toString();
}

export type CustomEmbedRoute = { kind: "player"; url: string } | { kind: "browser"; url: string };

export function isOfficialEmbedPlayerUrl(raw: string): boolean {
  return customEmbedRoute(raw).kind === "player";
}

export function customEmbedRoute(raw: string): CustomEmbedRoute {
  const normalized = normalizeCustomEmbedUrl(raw);
  let parsed: URL | null;
  try {
    parsed = new URL(normalized);
  } catch {
    parsed = null;
  }
  if (
    parsed &&
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    isOfficialEmbedPlayer(parsed)
  ) {
    return { kind: "player", url: normalized };
  }
  return { kind: "browser", url: normalized };
}
