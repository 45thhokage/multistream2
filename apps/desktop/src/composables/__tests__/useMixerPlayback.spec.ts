import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMixerPlayback } from "../useMixerPlayback";
import { invoke } from "@tauri-apps/api/core";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../useToast", () => ({ toast: { error: vi.fn() } }));
const available = vi.hoisted(() => ({ value: true }));
const streams = ref([
  { id: "one", workspaceId: "room" },
  { id: "two", workspaceId: "other" },
]);
const audio = { volume: 1, muted: true };
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/nativePlayer", () => ({ nativeOutputAvailable: () => available.value }));
vi.mock("../useStreams", () => ({ useStreams: () => ({ streams }) }));
vi.mock("../useWorkspaces", () => ({
  useWorkspaces: () => ({ workspaceIdOf: (id: string) => id }),
}));
vi.mock("../useStreamMixer", () => ({
  useStreamMixer: () => ({ mixes: ref({}), effectiveAudio: () => audio }),
}));

describe("native mixer playback", () => {
  let scope: EffectScope;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    available.value = true;
    scope = effectScope();
  });
  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
  });

  it("routes mute to each native tile instead of page media properties", async () => {
    // Arrange
    scope.run(useMixerPlayback);
    // Act
    streams.value = [...streams.value];
    await nextTick();
    // Assert
    expect(invoke).toHaveBeenCalledWith("tile_set_audio", {
      tileId: "one",
      volume: 1,
      muted: true,
    });
    expect(invoke).toHaveBeenCalledWith("tile_set_audio", {
      tileId: "two",
      volume: 1,
      muted: true,
    });
  });

  it("does not fall back to page mute in an unsupported browser", async () => {
    // Arrange
    available.value = false;
    scope.run(useMixerPlayback);
    // Act
    streams.value = [...streams.value];
    await nextTick();
    // Assert
    expect(invoke).not.toHaveBeenCalled();
  });
});
