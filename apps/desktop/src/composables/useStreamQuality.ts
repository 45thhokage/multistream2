import { createSharedComposable, useEventListener, useStorage } from "@vueuse/core";
import { onMounted, onScopeDispose, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { nativeOutputAvailable, nativePlayerId } from "@/lib/nativePlayer";
import { useI18n } from "vue-i18n";
import { toast } from "./useToast";

export interface QualityOption {
  id: string;
  label: string;
}
export interface QualityReport {
  options: QualityOption[];
  current: string;
  failed?: boolean;
}

export function validQualityReport(value: unknown): value is QualityReport {
  if (!value || typeof value !== "object") return false;
  const report = value as QualityReport;
  return (
    typeof report.current === "string" &&
    report.current.length <= 80 &&
    Array.isArray(report.options) &&
    report.options.length <= 32 &&
    report.options.every(
      (option) =>
        typeof option?.id === "string" &&
        /^[a-zA-Z0-9_:.-]{1,80}$/.test(option.id) &&
        typeof option.label === "string" &&
        option.label.length <= 100
    )
  );
}

export const useStreamQuality = createSharedComposable(() => {
  const reports = ref<Record<string, QualityReport>>({});
  const preferences = useStorage<Record<string, string>>("multistream-quality", {});
  const { t } = useI18n();
  const setQuality = async (tileId: string, quality: string) => {
    if (
      !nativeOutputAvailable() ||
      !reports.value[tileId]?.options.some((item) => item.id === quality)
    )
      return;
    try {
      await invoke("tile_set_quality", { tileId, quality });
    } catch {
      toast.error(t("mixer.qualityFailed"));
    }
  };
  return { reports, preferences, setQuality };
});

export function useQualityBridge() {
  const { reports, preferences } = useStreamQuality();
  const { t } = useI18n();
  const id = nativePlayerId();
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let restored = false;
  const publish = (value: unknown) => {
    if (!id || !validQualityReport(value)) return;
    reports.value[id] = value;
    void emitTo("main", "native-player-quality", { tileId: id, report: value });
    const saved = preferences.value[id];
    if (!restored && saved && value.options.some((option) => option.id === saved)) {
      restored = true;
      window.postMessage({ type: "MULTISTREAM_QUALITY_REQUEST", quality: saved }, "*");
    }
  };
  useEventListener(window, "multistream-quality-state", (event: Event) =>
    publish((event as CustomEvent).detail)
  );
  onMounted(async () => {
    if (!nativeOutputAvailable() || id) return;
    const cleanup = await listen<{ tileId: string; report: QualityReport }>(
      "native-player-quality",
      ({ payload }) => {
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(payload?.tileId) || !validQualityReport(payload.report))
          return;
        reports.value[payload.tileId] = payload.report;
        if (payload.report.failed) toast.error(t("mixer.qualityFailed"));
        else if (payload.report.options.some((option) => option.id === payload.report.current)) {
          preferences.value[payload.tileId] = payload.report.current;
        }
      }
    );
    if (disposed) cleanup();
    else unlisten = cleanup;
  });
  onScopeDispose(() => {
    disposed = true;
    unlisten?.();
  });
}
