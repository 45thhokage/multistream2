import { createSharedComposable, useStorage } from "@vueuse/core";
import { useWorkspaces } from "./useWorkspaces";

interface ChannelMix {
  volume: number;
  muted: boolean;
  solo: boolean;
}
interface WorkspaceMix {
  volume: number;
  muted: boolean;
  channels: Record<string, ChannelMix>;
  mode?: AudioMode;
  focusedId?: string;
}

export const AUDIO_MODES = ["click", "hover", "manual", "all-muted", "multi"] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];

export const useStreamMixer = createSharedComposable(() => {
  const mixes = useStorage<Record<string, WorkspaceMix>>("multistream-mixer", {});
  const { activeWorkspaceId } = useWorkspaces();
  const workspace = (id = activeWorkspaceId.value): WorkspaceMix =>
    (mixes.value[id] ??= { volume: 100, muted: false, channels: {} });
  const channel = (id: string, workspaceId = activeWorkspaceId.value): ChannelMix =>
    (workspace(workspaceId).channels[id] ??= { volume: 100, muted: false, solo: false });
  const effectiveAudio = (id: string, workspaceId: string, streamIds: string[]) => {
    const mix = workspace(workspaceId);
    const own = channel(id, workspaceId);
    const hasSolo = streamIds.some((key) => mix.channels[key]?.solo);
    const mode = mix.mode ?? "multi";
    const focused = streamIds.includes(mix.focusedId ?? "") ? mix.focusedId : streamIds[0];
    const focusMuted = mode === "all-muted" || (mode !== "multi" && id !== focused);
    return {
      volume: Math.max(0, Math.min(1, (own.volume * mix.volume) / 10000)),
      muted: mix.muted || own.muted || focusMuted || (hasSolo && !own.solo),
    };
  };
  const focusAudio = (id: string, workspaceId = activeWorkspaceId.value) => {
    workspace(workspaceId).focusedId = id;
  };
  const interact = (
    id: string,
    event: "click" | "hover",
    workspaceId = activeWorkspaceId.value
  ) => {
    if (workspace(workspaceId).mode === event) focusAudio(id, workspaceId);
  };
  return { mixes, workspace, channel, effectiveAudio, focusAudio, interact };
});
