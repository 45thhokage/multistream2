<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import { Download, RefreshCw, Trash2 } from "@lucide/vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/composables/useToast";
import { isTauri } from "@/lib/http";
import { useStreams } from "@/composables/useStreams";
import { useRecording } from "@/composables/useRecording";
import { useNetworkStatus } from "@/composables/useNetworkStatus";
import type { AdblockState } from "@/composables/useAdblock";
import type { DetectedMedia, SiteHlsStatus } from "@/composables/useSiteHls";

interface BlockedEvent {
  time: number;
  webview: string;
  url: string;
  host: string;
  pageHost: string;
  requestType: string;
  rule: string | null;
  list: string | null;
}

interface WebviewDiagnostics {
  webview: string;
  tileId: string;
  blocked: number;
  media: DetectedMedia[];
  siteHls: SiteHlsStatus | null;
}

interface Snapshot {
  generatedAt: number;
  appVersion: string;
  os: string;
  arch: string;
  adblock: AdblockState;
  blockedByList: [string, number][];
  recentBlocked: BlockedEvent[];
  webviews: WebviewDiagnostics[];
  engineBuildMs: number | null;
}

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const { t } = useI18n();
const { streams } = useStreams();
const { recordings, isDependenciesInstalled, orphans } = useRecording();
const { isOnline } = useNetworkStatus();

const snapshot = ref<Snapshot | null>(null);
const loading = ref(false);
const filter = ref("");
const available = isTauri();
let timer: ReturnType<typeof setInterval> | null = null;

const refresh = async () => {
  if (!available || loading.value) return;
  loading.value = true;
  try {
    snapshot.value = await invoke<Snapshot>("diagnostics_snapshot");
  } catch (error) {
    toast.error(String(error));
  } finally {
    loading.value = false;
  }
};

const tileName = (tileId: string) => {
  const stream = streams.value.find((s) => s.id === tileId);
  if (!stream) return tileId.startsWith("site-") ? t("diagnostics.siteWindow") : tileId.slice(0, 8);
  return stream.displayName || stream.handle || stream.channel;
};

const tiles = computed(() =>
  streams.value.map((s) => {
    const web = snapshot.value?.webviews.find((w) => w.tileId === s.id);
    const recording = recordings.get(s.id);
    return {
      id: s.id,
      name: s.displayName || s.handle || s.channel,
      platform: s.platform,
      blocked: web?.blocked ?? 0,
      media: web?.media.length ?? 0,
      siteHls: web?.siteHls?.state ?? (s.siteHls ? "enabled" : ""),
      recording: recording?.status ?? "",
    };
  })
);

const recentBlocked = computed(() => {
  const list = snapshot.value?.recentBlocked ?? [];
  const query = filter.value.trim().toLowerCase();
  if (!query) return list.slice(0, 200);
  return list
    .filter(
      (e) =>
        e.url.toLowerCase().includes(query) ||
        e.pageHost.includes(query) ||
        (e.list ?? "").toLowerCase().includes(query) ||
        (e.rule ?? "").toLowerCase().includes(query)
    )
    .slice(0, 200);
});

const mediaRows = computed(() =>
  (snapshot.value?.webviews ?? []).flatMap((w) =>
    w.media.map((m) => ({ ...m, tile: tileName(w.tileId) }))
  )
);

const time = (ms: number) => new Date(ms).toLocaleTimeString();

const clear = async () => {
  await invoke("diagnostics_clear").catch(() => {});
  await refresh();
};

const exportJson = () => {
  const payload = {
    ...snapshot.value,
    network: { online: isOnline.value },
    recording: {
      toolsInstalled: isDependenciesInstalled.value,
      active: [...recordings.values()].map((r) => ({
        platform: r.platform,
        status: r.status,
        elapsed: r.elapsed,
        quality: r.quality,
      })),
      leftoverFiles: orphans.value.length,
    },
    tiles: tiles.value,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `multistream-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

onMounted(() => {
  void refresh();
  timer = setInterval(refresh, 3000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <Dialog :open="open" :modal="false" @update:open="emit('update:open', $event)">
    <DialogContent
      class="bg-[#14161a] border-[#2a2d33] max-w-3xl md:max-w-4xl max-h-[88vh] flex flex-col"
      data-testid="diagnostics-dialog"
    >
      <DialogHeader>
        <DialogTitle class="text-white">{{ $t("diagnostics.title") }}</DialogTitle>
        <DialogDescription class="text-gray-400">{{
          $t("diagnostics.description")
        }}</DialogDescription>
      </DialogHeader>

      <p v-if="!available" class="text-sm text-gray-400">{{ $t("diagnostics.desktopOnly") }}</p>

      <div v-else class="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1 text-xs">
        <!-- Summary -->
        <section class="grid grid-cols-2 sm:grid-cols-4 gap-2" role="status">
          <div class="rounded-md border border-[#2a2d33] bg-[#1a1d22] p-2.5">
            <p class="text-gray-500">{{ $t("diagnostics.network") }}</p>
            <p :class="isOnline ? 'text-green-400' : 'text-red-400'" class="text-sm font-medium">
              {{ isOnline ? $t("diagnostics.online") : $t("diagnostics.offline") }}
            </p>
          </div>
          <div class="rounded-md border border-[#2a2d33] bg-[#1a1d22] p-2.5">
            <p class="text-gray-500">{{ $t("diagnostics.adblock") }}</p>
            <p class="text-sm font-medium text-white">
              {{
                snapshot?.adblock.config.enabled
                  ? $t("diagnostics.rules", {
                      count: (snapshot?.adblock.totalRules ?? 0).toLocaleString(),
                    })
                  : $t("diagnostics.off")
              }}
            </p>
          </div>
          <div class="rounded-md border border-[#2a2d33] bg-[#1a1d22] p-2.5">
            <p class="text-gray-500">{{ $t("diagnostics.blockedTotal") }}</p>
            <p class="text-sm font-medium text-white tabular-nums">
              {{ (snapshot?.adblock.blockedTotal ?? 0).toLocaleString() }}
            </p>
          </div>
          <div class="rounded-md border border-[#2a2d33] bg-[#1a1d22] p-2.5">
            <p class="text-gray-500">{{ $t("diagnostics.recorder") }}</p>
            <p
              class="text-sm font-medium"
              :class="isDependenciesInstalled ? 'text-green-400' : 'text-gray-400'"
            >
              {{
                isDependenciesInstalled
                  ? $t("diagnostics.installed")
                  : $t("diagnostics.notInstalled")
              }}
            </p>
          </div>
        </section>
        <p class="text-[11px] text-gray-500">
          {{ snapshot ? `v${snapshot.appVersion} · ${snapshot.os}/${snapshot.arch}` : "" }}
          <template v-if="snapshot?.engineBuildMs">
            · {{ $t("diagnostics.engineBuilt", { ms: snapshot.engineBuildMs }) }}</template
          >
          <template v-if="snapshot?.adblock.engineError">
            · <span class="text-red-400">{{ snapshot.adblock.engineError }}</span></template
          >
        </p>

        <!-- Tiles -->
        <section class="space-y-2">
          <h3 class="text-sm font-medium text-white">{{ $t("diagnostics.tiles") }}</h3>
          <p v-if="tiles.length === 0" class="text-gray-500">{{ $t("diagnostics.noTiles") }}</p>
          <table v-else class="w-full text-left">
            <thead class="text-gray-500">
              <tr>
                <th class="py-1 font-normal">{{ $t("diagnostics.tile") }}</th>
                <th class="py-1 font-normal">{{ $t("diagnostics.type") }}</th>
                <th class="py-1 font-normal text-right">{{ $t("diagnostics.blocked") }}</th>
                <th class="py-1 font-normal text-right">{{ $t("diagnostics.streamsFound") }}</th>
                <th class="py-1 font-normal">{{ $t("diagnostics.directHls") }}</th>
                <th class="py-1 font-normal">{{ $t("diagnostics.recording") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tile in tiles" :key="tile.id" class="border-t border-[#22252b]">
                <td class="py-1 pr-2 text-gray-200 max-w-48 truncate">{{ tile.name }}</td>
                <td class="py-1 pr-2 text-gray-400">{{ tile.platform }}</td>
                <td class="py-1 pr-2 text-right tabular-nums text-gray-300">{{ tile.blocked }}</td>
                <td class="py-1 pr-2 text-right tabular-nums text-gray-300">{{ tile.media }}</td>
                <td class="py-1 pr-2 text-gray-300">{{ tile.siteHls || "—" }}</td>
                <td class="py-1 text-gray-300">{{ tile.recording || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Lists -->
        <section v-if="snapshot?.blockedByList.length" class="space-y-2">
          <h3 class="text-sm font-medium text-white">{{ $t("diagnostics.byList") }}</h3>
          <ul class="flex flex-wrap gap-1.5">
            <li
              v-for="[name, count] in snapshot.blockedByList"
              :key="name"
              class="rounded-full border border-[#2a2d33] bg-[#1a1d22] px-2.5 py-0.5 text-gray-300"
            >
              {{ name }} <span class="tabular-nums text-gray-500">{{ count }}</span>
            </li>
          </ul>
        </section>

        <!-- Detected media -->
        <section class="space-y-2">
          <h3 class="text-sm font-medium text-white">{{ $t("diagnostics.media") }}</h3>
          <p v-if="mediaRows.length === 0" class="text-gray-500">{{ $t("diagnostics.noMedia") }}</p>
          <ul v-else class="space-y-1">
            <li v-for="m in mediaRows" :key="m.tile + m.url" class="flex gap-2">
              <span class="text-indigo-300 uppercase shrink-0">{{ m.kind }}</span>
              <span class="text-gray-400 shrink-0 max-w-32 truncate">{{ m.tile }}</span>
              <span class="font-mono text-gray-300 truncate" :title="m.url">{{ m.url }}</span>
            </li>
          </ul>
        </section>

        <!-- Blocked requests -->
        <section class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-white flex-1">
              {{ $t("diagnostics.recentBlocked") }}
            </h3>
            <label class="sr-only" for="diagnostics-filter">{{ $t("diagnostics.filter") }}</label>
            <input
              id="diagnostics-filter"
              v-model="filter"
              :placeholder="$t('diagnostics.filter')"
              class="h-7 w-48 px-2 rounded-md bg-[#1f2227] border border-[#2a2d33] text-xs text-white placeholder:text-gray-500"
            />
          </div>
          <p v-if="recentBlocked.length === 0" class="text-gray-500">
            {{ $t("diagnostics.noBlocked") }}
          </p>
          <ul v-else class="space-y-1 font-mono text-[11px]">
            <li
              v-for="(event, i) in recentBlocked"
              :key="event.time + ':' + i"
              class="rounded border border-[#22252b] bg-[#16181c] px-2 py-1"
            >
              <div class="flex gap-2 text-gray-500">
                <span>{{ time(event.time) }}</span>
                <span>{{ event.requestType }}</span>
                <span class="truncate">{{ event.pageHost }}</span>
                <span class="ml-auto text-indigo-300/80 truncate">{{ event.list ?? "" }}</span>
              </div>
              <p class="text-gray-300 truncate" :title="event.url">{{ event.url }}</p>
              <p v-if="event.rule" class="text-amber-300/70 truncate" :title="event.rule">
                {{ event.rule }}
              </p>
            </li>
          </ul>
        </section>
      </div>

      <div v-if="available" class="flex flex-wrap gap-2 pt-3 border-t border-[#2a2d33]/50">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2a2d33] hover:bg-[#3a3f4b] text-xs text-white"
          @click="refresh"
        >
          <RefreshCw :class="['size-3.5', loading ? 'animate-spin' : '']" aria-hidden="true" />
          {{ $t("diagnostics.refresh") }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2a2d33] hover:bg-[#3a3f4b] text-xs text-white"
          @click="exportJson"
        >
          <Download class="size-3.5" aria-hidden="true" />
          {{ $t("diagnostics.export") }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-gray-400 hover:text-red-400"
          @click="clear"
        >
          <Trash2 class="size-3.5" aria-hidden="true" />
          {{ $t("diagnostics.clear") }}
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
