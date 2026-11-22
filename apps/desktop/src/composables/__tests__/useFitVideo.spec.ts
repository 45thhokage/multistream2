import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope } from "vue";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  toast: { info: vi.fn() },
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useFitVideo } from "../useFitVideo";

const invokeMock = invoke as ReturnType<typeof vi.fn>;
const listenMock = listen as ReturnType<typeof vi.fn>;

type FitHandler = (event: { payload: { tileId: string; state: string } }) => void;

describe("useFitVideo", () => {
  let handler: FitHandler;
  let unlisten: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invokeMock.mockResolvedValue(undefined);
    unlisten = vi.fn();
    listenMock.mockImplementation(async (_name: string, callback: FitHandler) => {
      handler = callback;
      return unlisten;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Escape releases fitted tiles at once, even when a page never confirms", () => {
    // Arrange
    const scope = effectScope();
    const sut = scope.run(() => useFitVideo())!;
    handler({ payload: { tileId: "a", state: "on" } });
    handler({ payload: { tileId: "b", state: "off" } });
    expect(sut.anyFitted.value).toBe(true);

    // Act
    sut.exitAll();

    // Assert: only the fitted tile is asked to exit, and nothing counts as fitted any more
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("tile_fit_video", { tileId: "a", mode: "exit" });
    expect(sut.anyFitted.value).toBe(false);
    scope.stop();
  });

  it("stops listening when its last user goes away", async () => {
    // Arrange
    const scope = effectScope();
    scope.run(() => useFitVideo());
    await Promise.resolve();
    await Promise.resolve();

    // Act
    scope.stop();

    // Assert
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
