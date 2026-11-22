<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Plus, RefreshCw, ShieldCheck, Trash2, X } from "@lucide/vue";
import { TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/composables/useToast";
import { useAdblock } from "@/composables/useAdblock";

const { t, locale } = useI18n();
const adblock = useAdblock();
const config = computed(() => adblock.state.value?.config);

const busy = ref(false);
const newListName = ref("");
const newListUrl = ref("");
const newHost = ref("");
const rulesDraft = ref("");
const rulesDirty = ref(false);

watch(
  () => config.value?.customRules,
  (rules) => {
    if (!rulesDirty.value) rulesDraft.value = rules ?? "";
  },
  { immediate: true }
);

const INTERVALS = [6, 12, 24, 48, 168];

const relative = (ms: number | null | undefined): string => {
  if (!ms) return t("adblock.never");
  const stamp = ms < 1e12 ? ms * 1000 : ms;
  const minutes = Math.round((stamp - Date.now()) / 60000);
  const fmt = new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return fmt.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return fmt.format(hours, "hour");
  return fmt.format(Math.round(hours / 24), "day");
};

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

const updateNow = () =>
  run(async () => {
    const changed = await adblock.updateNow();
    toast.success(t("adblock.updated", { count: changed }));
  });

const addList = () =>
  run(async () => {
    await adblock.addList(newListName.value, newListUrl.value);
    newListName.value = "";
    newListUrl.value = "";
  }, t("adblock.listAdded"));

const saveRules = () =>
  run(async () => {
    await adblock.setCustomRules(rulesDraft.value);
    rulesDirty.value = false;
  }, t("adblock.rulesSaved"));

const addHost = () =>
  run(async () => {
    await adblock.allow(newHost.value);
    newHost.value = "";
  });

const intervalLabel = (hours: number) =>
  hours % 24 === 0
    ? t("adblock.everyDays", { n: hours / 24 })
    : t("adblock.everyHours", { n: hours });
</script>

<template>
  <TabsContent value="adblock" class="space-y-6 mt-0 outline-none">
    <p v-if="!adblock.supported" class="text-sm text-gray-400">{{ $t("adblock.desktopOnly") }}</p>
    <template v-else-if="config">
      <!-- Master switch -->
      <section class="flex items-start justify-between gap-4">
        <div class="flex gap-2.5">
          <ShieldCheck class="size-4 text-gray-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-medium text-white">{{ $t("adblock.title") }}</h3>
            <p class="text-xs text-gray-400">{{ $t("adblock.description") }}</p>
          </div>
        </div>
        <Switch
          :checked="config.enabled"
          :disabled="busy"
          :aria-label="$t('adblock.title')"
          @update:checked="(v?: boolean) => run(() => adblock.setEnabled(v === true))"
        />
      </section>

      <!-- Engine status + updates -->
      <section class="rounded-lg border border-[#2a2d33] bg-[#1a1d22] p-3 space-y-3">
        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400"
          role="status"
        >
          <span>{{
            $t("adblock.rules", { count: (adblock.state.value?.totalRules ?? 0).toLocaleString() })
          }}</span>
          <span>{{
            $t("adblock.blocked", {
              count: (adblock.state.value?.blockedTotal ?? 0).toLocaleString(),
            })
          }}</span>
          <span>{{
            $t("adblock.lastCheck", { when: relative(adblock.state.value?.lastUpdateCheck) })
          }}</span>
          <span v-if="adblock.state.value?.engineError" class="text-red-400">{{
            adblock.state.value.engineError
          }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            :disabled="busy || adblock.updating.value"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2a2d33] hover:bg-[#3a3f4b] text-xs text-white disabled:opacity-50"
            @click="updateNow"
          >
            <RefreshCw
              :class="['size-3.5', adblock.updating.value ? 'animate-spin' : '']"
              aria-hidden="true"
            />
            {{ adblock.updating.value ? $t("adblock.updating") : $t("adblock.updateNow") }}
          </button>
          <label class="flex items-center gap-2 text-xs text-gray-300">
            <Switch
              :checked="config.autoUpdate"
              :disabled="busy"
              :aria-label="$t('adblock.autoUpdate')"
              @update:checked="
                (v?: boolean) =>
                  run(() => adblock.setAutoUpdate(v === true, config!.updateIntervalHours))
              "
            />
            {{ $t("adblock.autoUpdate") }}
          </label>
          <label class="flex items-center gap-2 text-xs text-gray-300">
            <span class="sr-only">{{ $t("adblock.interval") }}</span>
            <select
              :value="config.updateIntervalHours"
              :disabled="busy || !config.autoUpdate"
              class="h-7 rounded-md bg-[#1f2227] border border-[#2a2d33] px-2 text-xs text-white disabled:opacity-50"
              @change="
                run(() =>
                  adblock.setAutoUpdate(true, Number(($event.target as HTMLSelectElement).value))
                )
              "
            >
              <option v-for="h in INTERVALS" :key="h" :value="h">{{ intervalLabel(h) }}</option>
            </select>
          </label>
        </div>
        <p class="text-[11px] text-gray-500">{{ $t("adblock.autoUpdateHint") }}</p>
      </section>

      <!-- Subscriptions -->
      <section class="space-y-2">
        <h3 class="text-sm font-medium text-white">{{ $t("adblock.lists") }}</h3>
        <ul class="space-y-1.5">
          <li
            v-for="list in config.lists"
            :key="list.id"
            class="flex items-center gap-3 rounded-md border border-[#2a2d33] bg-[#1a1d22] px-3 py-2"
          >
            <Switch
              :checked="list.enabled"
              :disabled="busy"
              :aria-label="list.name"
              @update:checked="
                (v?: boolean) => run(() => adblock.setListEnabled(list.id, v === true))
              "
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-gray-200 truncate" :title="list.url">{{ list.name }}</p>
              <p class="text-[11px] text-gray-500 truncate">
                <template v-if="list.lastError">
                  <span class="text-red-400">{{ list.lastError }}</span>
                </template>
                <template v-else-if="list.lastUpdated">
                  {{
                    $t("adblock.listMeta", {
                      rules: list.ruleCount.toLocaleString(),
                      when: relative(list.lastUpdated),
                    })
                  }}
                </template>
                <template v-else>{{ $t("adblock.notDownloaded") }}</template>
              </p>
            </div>
            <button
              v-if="!list.builtin"
              type="button"
              class="p-1 rounded text-gray-400 hover:text-red-400"
              :aria-label="$t('adblock.removeList', { name: list.name })"
              :disabled="busy"
              @click="run(() => adblock.removeList(list.id))"
            >
              <Trash2 class="size-3.5" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <form class="flex flex-wrap gap-2" @submit.prevent="addList">
          <label class="sr-only" for="adblock-list-name">{{ $t("adblock.listName") }}</label>
          <input
            id="adblock-list-name"
            v-model="newListName"
            :placeholder="$t('adblock.listName')"
            class="w-40 h-8 px-2.5 rounded-md bg-[#1f2227] border border-[#2a2d33] text-xs text-[#eaeaea] placeholder:text-gray-500"
          />
          <label class="sr-only" for="adblock-list-url">{{ $t("adblock.listUrl") }}</label>
          <input
            id="adblock-list-url"
            v-model="newListUrl"
            type="url"
            :placeholder="$t('adblock.listUrl')"
            class="flex-1 min-w-48 h-8 px-2.5 rounded-md bg-[#1f2227] border border-[#2a2d33] text-xs text-[#eaeaea] placeholder:text-gray-500"
          />
          <button
            type="submit"
            :disabled="busy || !newListUrl.trim()"
            class="inline-flex items-center gap-1 px-3 h-8 rounded-md bg-[#2a2d33] hover:bg-[#3a3f4b] text-xs text-white disabled:opacity-50"
          >
            <Plus class="size-3.5" aria-hidden="true" />
            {{ $t("adblock.addList") }}
          </button>
        </form>
      </section>

      <!-- Trusted sites -->
      <section class="space-y-2">
        <h3 class="text-sm font-medium text-white">{{ $t("adblock.allowlist") }}</h3>
        <p class="text-xs text-gray-400">{{ $t("adblock.allowlistHint") }}</p>
        <div v-if="config.allowlist.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="host in config.allowlist"
            :key="host"
            class="inline-flex items-center gap-1 rounded-full bg-[#1f2227] border border-[#2a2d33] pl-2.5 pr-1 py-0.5 text-xs text-gray-200"
          >
            {{ host }}
            <button
              type="button"
              class="p-0.5 rounded-full text-gray-400 hover:text-white"
              :aria-label="$t('adblock.removeAllow', { host })"
              @click="run(() => adblock.disallow(host))"
            >
              <X class="size-3" aria-hidden="true" />
            </button>
          </span>
        </div>
        <form class="flex gap-2" @submit.prevent="addHost">
          <label class="sr-only" for="adblock-allow-host">{{
            $t("adblock.allowPlaceholder")
          }}</label>
          <input
            id="adblock-allow-host"
            v-model="newHost"
            :placeholder="$t('adblock.allowPlaceholder')"
            class="flex-1 h-8 px-2.5 rounded-md bg-[#1f2227] border border-[#2a2d33] text-xs text-[#eaeaea] placeholder:text-gray-500"
          />
          <button
            type="submit"
            :disabled="busy || !newHost.trim()"
            class="px-3 h-8 rounded-md bg-[#2a2d33] hover:bg-[#3a3f4b] text-xs text-white disabled:opacity-50"
          >
            {{ $t("adblock.allowAdd") }}
          </button>
        </form>
      </section>

      <!-- Custom rules -->
      <section class="space-y-2">
        <h3 class="text-sm font-medium text-white">{{ $t("adblock.customRules") }}</h3>
        <p class="text-xs text-gray-400">{{ $t("adblock.customRulesHint") }}</p>
        <label class="sr-only" for="adblock-custom-rules">{{ $t("adblock.customRules") }}</label>
        <textarea
          id="adblock-custom-rules"
          v-model="rulesDraft"
          rows="6"
          spellcheck="false"
          placeholder="||ads.example.com^&#10;example.org##.banner"
          class="w-full rounded-md bg-[#1f2227] border border-[#2a2d33] p-2.5 font-mono text-xs text-[#eaeaea] placeholder:text-gray-600"
          @input="rulesDirty = true"
        />
        <button
          type="button"
          :disabled="busy || !rulesDirty"
          class="px-3 py-1.5 rounded-md bg-[#2a2d33] hover:bg-[#3a3f4b] text-xs text-white disabled:opacity-50"
          @click="saveRules"
        >
          {{ $t("adblock.saveRules") }}
        </button>
      </section>
    </template>
  </TabsContent>
</template>
