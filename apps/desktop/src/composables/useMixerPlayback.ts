import { useIntervalFn } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { toast } from "./useToast";
import { watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { nativeOutputAvailable } from "@/lib/nativePlayer";
import { useStreams } from "./useStreams";
import { useWorkspaces } from "./useWorkspaces";
import { useStreamMixer } from "./useStreamMixer";

export function useMixerPlayback() {
  const { t } = useI18n();
  const failed = new Set<string>();
  const { streams } = useStreams();
  const { workspaceIdOf } = useWorkspaces();
  const { mixes, effectiveAudio } = useStreamMixer();
  const apply = () => {
    if (!nativeOutputAvailable()) return;
    for (const stream of streams.value) {
      const workspaceId = workspaceIdOf(stream.workspaceId);
      const ids = streams.value
        .filter((item) => workspaceIdOf(item.workspaceId) === workspaceId)
        .map((item) => item.id);
      const audio = effectiveAudio(stream.id, workspaceId, ids);
      // A newly created native surface may not be ready yet; the interval retries.
      void invoke("tile_set_audio", { tileId: stream.id, ...audio })
        .then(() => failed.delete(stream.id))
        .catch((error: unknown) => {
          if (String(error).includes("tile webview not found") || failed.has(stream.id)) return;
          failed.add(stream.id);
          toast.error(t("mixer.outputFailed"));
        });
    }
  };
  watch([mixes, streams], apply, { deep: true, flush: "post" });
  useIntervalFn(apply, 1000);
}
