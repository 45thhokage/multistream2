import { createSharedComposable, useStorage } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/http";
import { ensureHttpUrl, siteFaviconForUrl, siteLabelForUrl, siteTitleForUrl } from "@/lib/siteMeta";

export interface SiteSession {
  label: string;
  url: string;
  title: string;
  faviconUrl: string;
  openedAt: number;
}

interface SiteWindowListItem {
  label: string;
  title: string;
}

const _useSiteWindows = () => {
  const sessions = useStorage<SiteSession[]>("site-sessions", []);

  const openSite = async (rawUrl: string, title?: string): Promise<SiteSession | null> => {
    const url = ensureHttpUrl(rawUrl);
    if (!url) return null;
    const label = siteLabelForUrl(url);
    const session: SiteSession = {
      label,
      url,
      title: siteTitleForUrl(url, title),
      faviconUrl: siteFaviconForUrl(url),
      openedAt: Date.now(),
    };
    if (isTauri()) {
      await invoke<string>("open_site_window", {
        label: session.label,
        url: session.url,
        title: session.title,
      });
    } else if (typeof window !== "undefined") {
      window.open(session.url, "_blank", "noopener");
    }
    const rest = sessions.value.filter((s) => s.label !== label);
    sessions.value = [session, ...rest];
    return session;
  };

  const closeSite = async (label: string): Promise<void> => {
    if (isTauri()) {
      await invoke("close_site_window", { label }).catch(() => {});
    }
    sessions.value = sessions.value.filter((s) => s.label !== label);
  };

  const reconcile = async (): Promise<void> => {
    if (!isTauri()) {
      sessions.value = [];
      return;
    }
    const open = await invoke<SiteWindowListItem[]>("list_site_windows").catch(
      () => [] as SiteWindowListItem[]
    );
    const labels = new Set(open.map((w) => w.label));
    sessions.value = sessions.value.filter((s) => labels.has(s.label));
  };

  return {
    sessions,
    openSite,
    closeSite,
    reconcile,
  };
};

export const useSiteWindows = createSharedComposable(_useSiteWindows);
