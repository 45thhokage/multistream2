import { useStorage } from "@vueuse/core";
import type { SidebarTab } from "./usePreferences";

/**
 * The left sidebar's sections and which of them are folded (adapted from Multi Worldview's
 * state/sidebarSections.ts, MIT). Tab order follows Multi Worldview's tab strip; stacked, the
 * column follows its stacked order. Workspaces starts folded (the list used to eat most of the
 * sidebar), everything else open.
 */
export const SIDEBAR_TAB_ORDER: readonly SidebarTab[] = [
  "streams",
  "layout",
  "following",
  "favorites",
  "presets",
  "history",
  "workspaces",
];
export const SIDEBAR_STACK_ORDER: readonly SidebarTab[] = [
  "workspaces",
  "streams",
  "layout",
  "presets",
  "following",
  "favorites",
  "history",
];
const COLLAPSED_BY_DEFAULT: Record<SidebarTab, boolean> = {
  workspaces: true,
  streams: false,
  layout: false,
  presets: false,
  following: false,
  favorites: false,
  history: false,
};

const explicit = useStorage<Partial<Record<SidebarTab, boolean>>>("sidebar-collapsed-sections", {});

export function isSidebarTab(value: unknown): value is SidebarTab {
  return typeof value === "string" && SIDEBAR_TAB_ORDER.includes(value as SidebarTab);
}

export function useSidebarSections() {
  const isCollapsed = (id: SidebarTab): boolean => explicit.value[id] ?? COLLAPSED_BY_DEFAULT[id];
  const setCollapsed = (id: SidebarTab, collapsed: boolean) => {
    explicit.value = { ...explicit.value, [id]: collapsed };
  };
  const toggle = (id: SidebarTab) => setCollapsed(id, !isCollapsed(id));
  const anyExpanded = (): boolean => SIDEBAR_STACK_ORDER.some((id) => !isCollapsed(id));
  /** Fold every section away, or bring them all back. */
  const setAll = (collapsed: boolean) => {
    explicit.value = Object.fromEntries(SIDEBAR_STACK_ORDER.map((id) => [id, collapsed]));
  };
  return { isCollapsed, setCollapsed, toggle, anyExpanded, setAll };
}
