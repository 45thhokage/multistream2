export function ensureHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function siteLabelForUrl(normalizedUrl: string): string {
  let hash = 5381;
  for (let i = 0; i < normalizedUrl.length; i++) {
    hash = ((hash << 5) + hash + normalizedUrl.charCodeAt(i)) >>> 0;
  }
  return `site-${hash.toString(36)}`;
}

export function siteTitleForUrl(normalizedUrl: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim().slice(0, 80);
  try {
    return new URL(normalizedUrl).hostname.replace(/^www\./, "");
  } catch {
    return normalizedUrl.slice(0, 80);
  }
}

export function siteFaviconForUrl(normalizedUrl: string): string {
  try {
    return `${new URL(normalizedUrl).origin}/favicon.ico`;
  } catch {
    return "";
  }
}

export function displayHostname(raw: string): string {
  const normalized = ensureHttpUrl(raw);
  if (!normalized) return raw.trim().slice(0, 80);
  try {
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return raw.trim().slice(0, 80);
  }
}
