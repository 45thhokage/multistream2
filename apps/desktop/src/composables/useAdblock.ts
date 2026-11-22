import { createSharedComposable } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ref } from "vue";
import { isTauri } from "@/lib/http";

export interface FilterList {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  builtin: boolean;
  hostsFormat: boolean;
  lastUpdated: number | null;
  lastAttempt: number | null;
  lastError: string | null;
  ruleCount: number;
  expiresHours: number | null;
}

export interface FilterConfig {
  enabled: boolean;
  autoUpdate: boolean;
  updateIntervalHours: number;
  lists: FilterList[];
  customRules: string;
  allowlist: string[];
}

export interface AdblockState {
  config: FilterConfig;
  updating: boolean;
  totalRules: number;
  engineReady: boolean;
  engineBuiltAt: number | null;
  engineError: string | null;
  lastUpdateCheck: number | null;
  blockedTotal: number;
}

/**
 * Website ad blocking (separate from the Twitch/Kick/YouTube player filter).
 * The backend owns the config; this mirrors it and refreshes on change events.
 */
const _useAdblock = () => {
  const state = ref<AdblockState | null>(null);
  const updating = ref(false);
  const supported = isTauri();

  const refresh = async () => {
    if (!supported) return;
    try {
      state.value = await invoke<AdblockState>("adblock_get_state");
      updating.value = state.value.updating;
    } catch {
      // keep the last known state
    }
  };

  if (supported) {
    void listen("adblock-updated", () => void refresh());
    void listen<boolean>("adblock-updating", (event) => {
      updating.value = event.payload;
    });
    void refresh();
  }

  const call = async <T = void>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const result = await invoke<T>(command, args);
    await refresh();
    return result;
  };

  const isAllowlisted = (host: string): boolean => {
    const clean = host.replace(/^www\./, "").toLowerCase();
    return (state.value?.config.allowlist ?? []).some(
      (entry) => clean === entry || clean.endsWith(`.${entry}`)
    );
  };

  return {
    state,
    updating,
    supported,
    refresh,
    isAllowlisted,
    setEnabled: (enabled: boolean) => call("adblock_set_enabled", { enabled }),
    setAutoUpdate: (enabled: boolean, intervalHours: number) =>
      call("adblock_set_auto_update", { enabled, intervalHours }),
    setListEnabled: (id: string, enabled: boolean) =>
      call("adblock_set_list_enabled", { id, enabled }),
    addList: (name: string, url: string) => call("adblock_add_list", { name, url }),
    removeList: (id: string) => call("adblock_remove_list", { id }),
    updateNow: () => call<number>("adblock_update_now"),
    setCustomRules: (rules: string) => call("adblock_set_custom_rules", { rules }),
    allow: (host: string) => call<string>("adblock_allowlist_add", { host }),
    disallow: (host: string) => call("adblock_allowlist_remove", { host }),
  };
};

export const useAdblock = createSharedComposable(_useAdblock);
