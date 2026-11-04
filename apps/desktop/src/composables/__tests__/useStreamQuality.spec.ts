import { effectScope, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStreamQuality, validQualityReport } from "../useStreamQuality";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/nativePlayer", () => ({
  nativeOutputAvailable: () => true,
  nativePlayerId: () => null,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../useToast", () => ({ toast: { error: vi.fn() } }));

describe("stream quality", () => {
  let scope: EffectScope;
  let quality: ReturnType<typeof useStreamQuality>;
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    scope = effectScope();
    scope.run(() => {
      quality = useStreamQuality();
    });
    vi.mocked(invoke).mockResolvedValue(undefined);
  });
  afterEach(() => scope.stop());

  it("only sends qualities actually offered by the player", async () => {
    // Arrange
    quality.reports.value.one = { options: [{ id: "720p60", label: "720p60" }], current: "auto" };
    // Act
    await quality.setQuality("one", "1080p");
    await quality.setQuality("one", "720p60");
    // Assert
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("tile_set_quality", { tileId: "one", quality: "720p60" });
    expect(quality.preferences.value.one).toBeUndefined();
  });
  it("rejects malformed or oversized provider reports", () => {
    // Arrange
    const valid = { options: [{ id: "hd1080", label: "1080p" }], current: "hd1080" };
    // Act
    const results = [
      validQualityReport(valid),
      validQualityReport({ ...valid, options: [{ id: "a b", label: "x" }] }),
      validQualityReport({ ...valid, options: Array(33).fill(valid.options[0]) }),
    ];
    // Assert
    expect(results).toEqual([true, false, false]);
  });
});
