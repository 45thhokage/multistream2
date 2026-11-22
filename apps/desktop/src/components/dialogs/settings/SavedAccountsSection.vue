<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Check, Plus, Trash2, UserCheck, UsersRound } from "@lucide/vue";
import { toast } from "@/composables/useToast";
import { useAccounts } from "@/composables/useAccounts";
import { PLATFORMS } from "@/config/platforms";

const emit = defineEmits<{ (e: "close"): void }>();
const { t } = useI18n();
const accounts = useAccounts();
const busy = ref(false);

const run = async (action: () => Promise<unknown>, success?: string) => {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
    if (success) toast.success(success);
  } catch (error) {
    toast.error(String(error));
  } finally {
    busy.value = false;
  }
};

/** Keeps the current account saved, signs out locally, then opens the sign-in dialog. */
const addAccount = (platform: "twitch" | "kick") =>
  run(async () => {
    await accounts.prepareAdd(platform);
    window.dispatchEvent(
      new CustomEvent("multistream-show-dialog", {
        detail: platform === "twitch" ? "twitch-auth" : "kick-auth",
      })
    );
    emit("close");
  });

const platforms = ["twitch", "kick"] as const;
</script>

<template>
  <section v-if="accounts.supported" class="space-y-4" data-testid="saved-accounts">
    <div class="flex items-center gap-2.5 px-0.5">
      <UsersRound class="size-4 text-gray-400 shrink-0" aria-hidden="true" />
      <div>
        <h3 class="text-white text-sm font-medium">{{ $t("accounts.title") }}</h3>
        <p class="text-gray-400 text-xs mt-0.5">{{ $t("accounts.description") }}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div
        v-for="platform in platforms"
        :key="platform"
        class="rounded-xl border border-[#2a2d33]/60 bg-[#14161a] p-3 space-y-2"
      >
        <div class="flex items-center gap-2">
          <component
            :is="PLATFORMS[platform].icon"
            :size="14"
            :style="{ color: PLATFORMS[platform].color }"
            aria-hidden="true"
          />
          <span class="text-sm font-medium text-white">{{ PLATFORMS[platform].name }}</span>
        </div>
        <p
          v-if="(accounts.accounts.value?.[platform] ?? []).length === 0"
          class="text-xs text-gray-500"
        >
          {{ $t("accounts.none") }}
        </p>
        <ul v-else class="space-y-1">
          <li
            v-for="account in accounts.accounts.value?.[platform] ?? []"
            :key="account.username"
            class="flex items-center gap-2 rounded-md bg-[#1a1d22] px-2 py-1.5"
          >
            <span class="flex-1 min-w-0 truncate text-sm text-gray-200">{{
              account.username
            }}</span>
            <span
              v-if="account.active"
              class="inline-flex items-center gap-1 text-[11px] text-green-400"
            >
              <Check class="size-3" aria-hidden="true" />
              {{ $t("accounts.active") }}
            </span>
            <template v-else>
              <button
                type="button"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-300 hover:text-white hover:bg-white/5"
                :disabled="busy"
                @click="
                  run(
                    () => accounts.switchAccount(platform, account.username),
                    t('accounts.switched', { name: account.username })
                  )
                "
              >
                <UserCheck class="size-3.5" aria-hidden="true" />
                {{ $t("accounts.use") }}
              </button>
              <button
                type="button"
                class="p-1 rounded text-gray-400 hover:text-red-400"
                :aria-label="$t('accounts.remove', { name: account.username })"
                :disabled="busy"
                @click="run(() => accounts.removeAccount(platform, account.username))"
              >
                <Trash2 class="size-3.5" aria-hidden="true" />
              </button>
            </template>
          </li>
        </ul>
        <button
          type="button"
          class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          :disabled="busy"
          @click="addAccount(platform)"
        >
          <Plus class="size-3.5" aria-hidden="true" />
          {{ $t("accounts.add") }}
        </button>
      </div>
    </div>

    <div v-if="accounts.accounts.value?.siteProfilesSupported" class="space-y-2">
      <h4 class="text-xs font-medium text-gray-300">{{ $t("accounts.sites") }}</h4>
      <p class="text-xs text-gray-500">{{ $t("accounts.sitesHint") }}</p>
      <ul v-if="(accounts.accounts.value?.sites ?? []).length" class="space-y-1">
        <li
          v-for="site in accounts.accounts.value?.sites ?? []"
          :key="site.id"
          class="flex items-center gap-2 rounded-md bg-[#1a1d22] px-2 py-1.5"
        >
          <span class="text-xs text-gray-400 w-32 truncate">{{ site.domain }}</span>
          <span class="flex-1 min-w-0 truncate text-sm text-gray-200">{{ site.name }}</span>
          <button
            type="button"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-300 hover:text-white hover:bg-white/5"
            :disabled="busy"
            @click="run(() => accounts.switchSite(site.id), t('siteTools.accounts.switched'))"
          >
            <UserCheck class="size-3.5" aria-hidden="true" />
            {{ $t("accounts.use") }}
          </button>
          <button
            type="button"
            class="p-1 rounded text-gray-400 hover:text-red-400"
            :aria-label="$t('accounts.remove', { name: site.name })"
            :disabled="busy"
            @click="run(() => accounts.removeSite(site.id))"
          >
            <Trash2 class="size-3.5" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
