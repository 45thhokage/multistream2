<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowDown } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { useDataUsage } from "@/composables/useDataUsage";
import { useStreams } from "@/composables/useStreams";
import { formatBytes, formatRate } from "@/lib/usageMeter";

const { t } = useI18n();
const { available, tiles, rate, sessionBytes, monthBytes } = useDataUsage();
const { streams } = useStreams();
const open = ref(false);

interface Row {
  id: string;
  name: string;
  rate: number;
  bytes: number;
}

// Streams that are playing show by name; anything else a tile loads (website tiles that were
// closed, etc.) is folded into one row so the total always adds up.
const rows = computed<Row[]>(() => {
  const names = new Map(streams.value.map((s) => [s.id, s.displayName || s.channel]));
  const named: Row[] = [];
  const other = { id: "other", name: t("usage.other"), rate: 0, bytes: 0 };
  for (const [id, usage] of Object.entries(tiles.value)) {
    const name = names.get(id);
    if (name) named.push({ id, name, rate: usage.rate, bytes: usage.bytes });
    else {
      other.rate += usage.rate;
      other.bytes += usage.bytes;
    }
  }
  named.sort((a, b) => b.rate - a.rate || b.bytes - a.bytes);
  return other.bytes > 0 ? [...named, other] : named;
});
</script>

<template>
  <!-- The panel is a role="dialog" while open so the native stream tiles are cut out beneath it
       and it stays visible above them (see useBrowserTiles). -->
  <div
    v-if="available"
    class="relative shrink-0"
    @mouseenter="open = true"
    @mouseleave="open = false"
    @focusin="open = true"
    @focusout="open = false"
    @keydown.esc="open = false"
  >
    <button
      type="button"
      data-testid="data-usage"
      :aria-label="$t('usage.title')"
      :aria-expanded="open"
      class="h-8 min-w-24 inline-flex items-center justify-center gap-1 rounded-md border border-[#2a2d33] bg-[#1e2127] px-2.5 text-xs tabular-nums text-gray-200 transition-colors hover:bg-[#2a2d33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <ArrowDown class="size-3 text-gray-400" aria-hidden="true" />{{ formatRate(rate) }}
    </button>
    <div v-if="open" class="absolute right-0 top-full z-50 pt-1">
      <div
        role="dialog"
        :aria-label="$t('usage.title')"
        data-testid="data-usage-panel"
        class="w-72 rounded-lg border border-[#262930] bg-[#14161a] p-3 text-xs text-gray-300 shadow-xl"
      >
        <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 tabular-nums">
          <dt>{{ $t("usage.now") }}</dt>
          <dd class="text-right font-semibold text-white">{{ formatRate(rate) }}</dd>
          <dt>{{ $t("usage.session") }}</dt>
          <dd class="text-right font-semibold text-white">{{ formatBytes(sessionBytes) }}</dd>
          <dt>{{ $t("usage.month") }}</dt>
          <dd class="text-right font-semibold text-white">{{ formatBytes(monthBytes) }}</dd>
        </dl>
        <div class="my-2.5 border-t border-[#262930]" />
        <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
          {{ $t("usage.byStream") }}
        </p>
        <p v-if="rows.length === 0" class="py-1 text-gray-500">{{ $t("usage.idle") }}</p>
        <ul v-else class="max-h-64 space-y-1.5 overflow-y-auto tabular-nums">
          <li v-for="row in rows" :key="row.id" class="flex items-baseline gap-3">
            <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
            <span class="font-semibold text-white">{{ formatRate(row.rate) }}</span>
            <span class="w-14 text-right text-gray-500">{{ formatBytes(row.bytes) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
