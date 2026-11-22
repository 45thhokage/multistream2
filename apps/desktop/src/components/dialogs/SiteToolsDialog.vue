<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Circle, CircleStop, Copy, LogOut, Plus, RefreshCw, Trash2, UserCheck } from "@lucide/vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/composables/useToast";
import { useAdblock } from "@/composables/useAdblock";
import { useAccounts } from "@/composables/useAccounts";
import { useRecording } from "@/composables/useRecording";
import { usePreferences } from "@/composables/usePreferences";
import { useSiteHls, type DetectedMedia } from "@/composables/useSiteHls";
import { useStreams } from "@/composables/useStreams";
import { mediaLabel } from "@/lib/mediaSource";

const props = defineProps<{
  open: boolean;
  tileId: string;
  channel: string;
  pageUrl: string;
}>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const { t } = useI18n();
const { streams, updateStream, addStream } = useStreams();
const siteHls = useSiteHls();
const adblock = useAdblock();
const accounts = useAccounts();
const { startRecording, stopRecording, isRecording, isDependenciesInstalled } = useRecording();
const { recordingQuality } = usePreferences();

const detected = ref<DetectedMedia[]>([]);
const domain = ref("");
const profileName = ref("");
const busy = ref(false);

const stream = computed(() => streams.value.find((s) => s.id === props.tileId));
const directEnabled = computed(() => stream.value?.siteHls === true);
const status = computed(() => siteHls.statuses.value[props.tileId]);
const host = computed(() => {
  try {
    return new URL(props.pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
});
const blockingHere = computed(() => !adblock.isAllowlisted(host.value));
const profiles = computed(() => (domain.value ? accounts.sitesFor(domain.value) : []));
const recording = computed(() => isRecording(props.tileId));

const statusText = computed(() => {
  const s = status.value;
  if (!directEnabled.value) return t("siteTools.direct.off");
  if (!s) return t("siteTools.direct.waiting");
  const key = `siteTools.direct.state.${s.state}`;
  const label = t(key) !== key ? t(key) : s.state;
  return [
    label,
    s.level,
    s.source ? t("siteTools.direct.via", { source: s.source }) : "",
    s.message,
  ]
    .filter(Boolean)
    .join(" · ");
});

const loadDetails = async () => {
  detected.value = await siteHls.detected(props.tileId).catch(() => []);
  domain.value = await accounts.siteDomain(props.tileId).catch(() => host.value);
  void accounts.refresh();
};

watch(
  () => props.open,
  (open) => {
    if (open) void loadDetails();
  },
  { immediate: true }
);
watch(
  () => siteHls.detectedCount.value[props.tileId],
  () => {
    if (props.open) void loadDetails();
  }
);

const guarded = async (action: () => Promise<unknown>, success?: string) => {
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

const toggleDirect = (value?: boolean) => {
  const enabled = value === true;
  return guarded(async () => {
    updateStream(props.tileId, { siteHls: enabled });
    await siteHls.setDirect(props.tileId, enabled);
  });
};

const toggleRecording = () =>
  guarded(async () => {
    if (recording.value) await stopRecording(props.tileId);
    else
      await startRecording(
        { id: props.tileId, channel: props.channel, platform: "custom" },
        recordingQuality.value || "best",
        props.pageUrl
      );
  });

const toggleBlocking = (value?: boolean) => {
  const enabled = value === true;
  return guarded(async () => {
    if (!host.value) return;
    if (enabled) await adblock.disallow(host.value);
    else await adblock.allow(host.value);
  }, t("siteTools.adblock.reloadHint"));
};

const copy = async (url: string) => {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(t("share.toast"));
  } catch {
    toast.error(url);
  }
};

const openAsTile = (media: DetectedMedia) => {
  addStream(media.url, "custom", media.url, mediaLabel(media.url));
};

const saveProfile = () =>
  guarded(async () => {
    await accounts.saveSite(props.tileId, profileName.value);
    profileName.value = "";
  }, t("siteTools.accounts.saved"));

const switchProfile = (id: string) =>
  guarded(() => accounts.switchSite(id), t("siteTools.accounts.switched"));

const signOut = () =>
  guarded(() => accounts.signOutSite(props.tileId), t("siteTools.accounts.signedOut"));

const removeProfile = (id: string) => guarded(() => accounts.removeSite(id));
</script>

<template>
  <Dialog :open="open" :modal="false" @update:open="emit('update:open', $event)">
    <DialogContent class="bg-[#14161a] border-[#2a2d33] max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="text-white">{{ $t("siteTools.title") }}</DialogTitle>
        <DialogDescription class="text-gray-400 truncate">{{ host || pageUrl }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-5 text-sm">
        <!-- Direct stream playback -->
        <section class="space-y-2">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-medium text-white">{{ $t("siteTools.direct.title") }}</h3>
              <p class="text-xs text-gray-400">{{ $t("siteTools.direct.description") }}</p>
            </div>
            <Switch
              :checked="directEnabled"
              :disabled="busy || !siteHls.supported"
              :aria-label="$t('siteTools.direct.title')"
              @update:checked="toggleDirect"
            />
          </div>
          <p class="text-xs text-indigo-300/90" role="status">{{ statusText }}</p>
        </section>

        <!-- Detected streams -->
        <section class="space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="font-medium text-white">{{ $t("siteTools.detected.title") }}</h3>
            <button
              type="button"
              class="p-1 rounded text-gray-400 hover:text-white"
              :aria-label="$t('siteTools.detected.refresh')"
              @click="loadDetails"
            >
              <RefreshCw class="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <p v-if="detected.length === 0" class="text-xs text-gray-500">
            {{ $t("siteTools.detected.none") }}
          </p>
          <ul v-else class="space-y-1.5">
            <li
              v-for="media in detected"
              :key="media.url"
              class="flex items-center gap-2 rounded-md bg-[#1e2127] border border-[#2a2d33] px-2 py-1.5"
            >
              <span class="text-[10px] font-semibold uppercase text-indigo-300">{{
                media.kind
              }}</span>
              <span
                class="flex-1 min-w-0 truncate font-mono text-[11px] text-gray-300"
                :title="media.url"
                >{{ media.url }}</span
              >
              <button
                type="button"
                class="p-1 rounded text-gray-400 hover:text-white"
                :aria-label="$t('siteTools.detected.copy')"
                @click="copy(media.url)"
              >
                <Copy class="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="px-1.5 py-0.5 rounded text-[11px] text-gray-300 hover:text-white hover:bg-white/5"
                @click="openAsTile(media)"
              >
                {{ $t("siteTools.detected.openTile") }}
              </button>
            </li>
          </ul>
        </section>

        <!-- Recording -->
        <section class="space-y-2">
          <h3 class="font-medium text-white">{{ $t("siteTools.record.title") }}</h3>
          <p class="text-xs text-gray-400">{{ $t("siteTools.record.description") }}</p>
          <button
            type="button"
            :disabled="busy || !isDependenciesInstalled"
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50',
              recording
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-[#2a2d33] hover:bg-[#3a3f4b] text-white',
            ]"
            @click="toggleRecording"
          >
            <CircleStop v-if="recording" class="size-3.5" aria-hidden="true" />
            <Circle v-else class="size-3.5" aria-hidden="true" />
            {{ recording ? $t("stream.actions.stopRecord") : $t("stream.actions.record") }}
          </button>
          <p v-if="!isDependenciesInstalled" class="text-xs text-gray-500">
            {{ $t("siteTools.record.needsTools") }}
          </p>
        </section>

        <!-- Ad blocking -->
        <section v-if="adblock.supported" class="space-y-2">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-medium text-white">{{ $t("siteTools.adblock.title") }}</h3>
              <p class="text-xs text-gray-400">
                {{
                  adblock.state.value?.config.enabled
                    ? $t("siteTools.adblock.description", { host })
                    : $t("siteTools.adblock.globallyOff")
                }}
              </p>
            </div>
            <Switch
              :checked="blockingHere"
              :disabled="busy || !host || !adblock.state.value?.config.enabled"
              :aria-label="$t('siteTools.adblock.title')"
              @update:checked="toggleBlocking"
            />
          </div>
        </section>

        <!-- Sign-in profiles -->
        <section v-if="accounts.accounts.value?.siteProfilesSupported" class="space-y-2">
          <h3 class="font-medium text-white">{{ $t("siteTools.accounts.title", { domain }) }}</h3>
          <p class="text-xs text-gray-400">{{ $t("siteTools.accounts.description") }}</p>
          <ul v-if="profiles.length" class="space-y-1.5">
            <li
              v-for="profile in profiles"
              :key="profile.id"
              class="flex items-center gap-2 rounded-md bg-[#1e2127] border border-[#2a2d33] px-2 py-1.5"
            >
              <span class="flex-1 min-w-0 truncate text-gray-200">{{ profile.name }}</span>
              <span class="text-[11px] text-gray-500">{{
                new Date(profile.savedAt).toLocaleDateString()
              }}</span>
              <button
                type="button"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-300 hover:text-white hover:bg-white/5"
                :disabled="busy"
                @click="switchProfile(profile.id)"
              >
                <UserCheck class="size-3.5" aria-hidden="true" />
                {{ $t("siteTools.accounts.use") }}
              </button>
              <button
                type="button"
                class="p-1 rounded text-gray-400 hover:text-red-400"
                :aria-label="$t('siteTools.accounts.remove')"
                :disabled="busy"
                @click="removeProfile(profile.id)"
              >
                <Trash2 class="size-3.5" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <form class="flex gap-2" @submit.prevent="saveProfile">
            <label class="sr-only" :for="`profile-name-${tileId}`">{{
              $t("siteTools.accounts.nameLabel")
            }}</label>
            <input
              :id="`profile-name-${tileId}`"
              v-model="profileName"
              maxlength="60"
              :placeholder="$t('siteTools.accounts.namePlaceholder')"
              class="flex-1 h-8 px-2.5 rounded-md bg-[#1f2227] border border-[#2a2d33] text-xs text-[#eaeaea] placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <button
              type="submit"
              :disabled="busy || !profileName.trim()"
              class="inline-flex items-center gap-1 px-3 h-8 rounded-md bg-[#2a2d33] hover:bg-[#3a3f4b] text-xs text-white disabled:opacity-50"
            >
              <Plus class="size-3.5" aria-hidden="true" />
              {{ $t("siteTools.accounts.save") }}
            </button>
          </form>
          <button
            type="button"
            :disabled="busy"
            class="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400"
            @click="signOut"
          >
            <LogOut class="size-3.5" aria-hidden="true" />
            {{ $t("siteTools.accounts.signOut", { domain }) }}
          </button>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
