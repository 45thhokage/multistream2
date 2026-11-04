import { effectScope, type EffectScope } from "vue";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useNativeOverlay } from "../useNativeOverlay";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }));
vi.mock("@/lib/nativePlayer", () => ({ nativeOutputAvailable: () => true }));

describe("native overlays", () => {
  let scope: EffectScope;
  const rect = { x: 100, y: 50, width: 256, height: 210 };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", new EventTarget());
    scope = effectScope();
  });
  afterEach(async () => {
    scope.stop();
    await flushPromises();
    vi.unstubAllGlobals();
  });

  it("cancels a preview that closes before native creation starts", async () => {
    // Arrange
    const preview = scope.run(() => useNativeOverlay("preview"))!;
    // Act
    preview.show(rect);
    preview.close();
    await flushPromises();
    // Assert
    expect(invoke).not.toHaveBeenCalledWith("open_ui_overlay", expect.anything());
    expect(preview.opened.value).toBe(false);
  });

  it("replaces a preview with Layout and closes the previous owner's state", async () => {
    // Arrange
    const preview = scope.run(() => useNativeOverlay("preview"))!;
    const layout = scope.run(() => useNativeOverlay("layout"))!;
    preview.show(rect);
    await flushPromises();
    vi.clearAllMocks();
    // Act
    layout.show(rect);
    await flushPromises();
    preview.close();
    await flushPromises();
    // Assert
    expect(preview.opened.value).toBe(false);
    expect(layout.opened.value).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, "close_ui_overlay");
    expect(invoke).toHaveBeenNthCalledWith(2, "open_ui_overlay", {
      kind: "layout",
      data: "{}",
      ...rect,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
