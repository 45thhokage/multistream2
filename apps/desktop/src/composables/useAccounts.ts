import { createSharedComposable } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ref } from "vue";
import { isTauri } from "@/lib/http";

export interface PlatformAccount {
  username: string;
  active: boolean;
}

export interface SiteAccount {
  id: string;
  name: string;
  domain: string;
  savedAt: number;
  cookieCount: number;
}

export interface AccountsView {
  twitch: PlatformAccount[];
  kick: PlatformAccount[];
  sites: SiteAccount[];
  siteProfilesSupported: boolean;
}

/** Saved Twitch/Kick accounts and website sign-in profiles. */
const _useAccounts = () => {
  const accounts = ref<AccountsView | null>(null);
  const supported = isTauri();

  const refresh = async () => {
    if (!supported) return;
    try {
      accounts.value = await invoke<AccountsView>("accounts_list");
    } catch {
      // keep the last known list
    }
  };

  if (supported) {
    // Logging in or out changes which account is active (and saves new ones).
    void listen("twitch-auth-changed", () => void refresh());
    void listen("kick-auth-changed", () => void refresh());
    void refresh();
  }

  const run = async <T = void>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const result = await invoke<T>(command, args);
    await refresh();
    return result;
  };

  const sitesFor = (domain: string): SiteAccount[] =>
    (accounts.value?.sites ?? []).filter((s) => s.domain === domain);

  return {
    accounts,
    supported,
    refresh,
    sitesFor,
    switchAccount: (platform: "twitch" | "kick", username: string) =>
      run("accounts_switch", { platform, username }),
    removeAccount: (platform: "twitch" | "kick", username: string) =>
      run("accounts_remove", { platform, username }),
    prepareAdd: (platform: "twitch" | "kick") => run("accounts_prepare_add", { platform }),
    siteDomain: (tileId: string) => invoke<string>("site_account_domain", { tileId }),
    saveSite: (tileId: string, name: string) =>
      run<SiteAccount>("site_account_save", { tileId, name }),
    switchSite: (id: string) => run("site_account_switch", { id }),
    signOutSite: (tileId: string) => run<string>("site_account_sign_out", { tileId }),
    removeSite: (id: string) => run("site_account_remove", { id }),
  };
};

export const useAccounts = createSharedComposable(_useAccounts);
