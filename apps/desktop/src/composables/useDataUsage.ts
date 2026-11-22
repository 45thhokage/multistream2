import { listen } from "@tauri-apps/api/event";
import { computed, readonly, ref } from "vue";
import { isTauri } from "@/lib/http";
import { createUsageMeter, type TileRate, type TileUsage } from "@/lib/usageMeter";

interface BandwidthStats {
  intervalMs: number;
  tiles: TileUsage[];
}

const MONTH_KEY = "data-usage-month";
const SAVE_EVERY_MS = 10_000;

interface MonthTotal {
  month: string;
  bytes: number;
}

const currentMonth = (): string => new Date().toISOString().slice(0, 7);

const loadMonth = (): MonthTotal => {
  try {
    const saved = JSON.parse(localStorage.getItem(MONTH_KEY) ?? "null") as MonthTotal | null;
    if (saved && saved.month === currentMonth() && Number.isFinite(saved.bytes)) return saved;
  } catch {
    // Unreadable or unavailable storage just restarts the month total.
  }
  return { month: currentMonth(), bytes: 0 };
};

const meter = createUsageMeter();
const tiles = ref<Record<string, TileRate>>({});
const rate = ref(0);
const sessionBytes = ref(0);
const month = ref<MonthTotal>({ month: currentMonth(), bytes: 0 });
let started = false;
let lastSession = 0;
let lastSaved = 0;

const saveMonth = (): void => {
  try {
    localStorage.setItem(MONTH_KEY, JSON.stringify(month.value));
  } catch {
    // Persisting is best effort.
  }
};

const ingest = (stats: BandwidthStats): void => {
  const snapshot = meter.ingest(stats.tiles, stats.intervalMs);
  tiles.value = snapshot.tiles;
  rate.value = snapshot.rate;
  sessionBytes.value = snapshot.sessionBytes;
  const added = Math.max(0, snapshot.sessionBytes - lastSession);
  lastSession = snapshot.sessionBytes;
  if (month.value.month !== currentMonth()) month.value = { month: currentMonth(), bytes: 0 };
  month.value.bytes += added;
  const now = Date.now();
  if (added > 0 && now - lastSaved >= SAVE_EVERY_MS) {
    lastSaved = now;
    saveMonth();
  }
};

function start(): void {
  if (started || !isTauri()) return;
  started = true;
  month.value = loadMonth();
  void listen<BandwidthStats>("bandwidth-stats", (event) => ingest(event.payload)).catch(() => {
    started = false;
  });
  window.addEventListener?.("beforeunload", saveMonth);
}

/** Live download usage of the stream tiles; only reported by the desktop app. */
export function useDataUsage() {
  start();
  return {
    available: computed(() => isTauri()),
    tiles: readonly(tiles),
    rate: readonly(rate),
    sessionBytes: readonly(sessionBytes),
    monthBytes: computed(() => month.value.bytes),
  };
}
