import { afterEach, describe, expect, it, vi } from "vitest";
import { nativePlayerId, nativeOutputAvailable, usesPlayerSurface } from "../nativePlayer";

describe("isolated native player routing", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the native output path on Windows desktop", () => {
    // Arrange
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", { platform: "Win32" });
    // Act
    const available = nativeOutputAvailable();
    // Assert
    expect(available).toBe(true);
    expect(usesPlayerSurface({ id: "one", channel: "example", platform: "twitch" })).toBe(true);
  });
  it("rejects unsupported platforms", () => {
    // Arrange
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    // Act
    const available = nativeOutputAvailable();
    // Assert
    expect(available).toBe(false);
  });
  it.each(["a/b", "<script>", ""])("rejects an invalid native player id %s", (id) => {
    // Arrange
    vi.stubGlobal("location", { search: `?nativePlayer=${encodeURIComponent(id)}` });
    // Act
    const result = nativePlayerId();
    // Assert
    expect(result).toBeNull();
  });
  it("accepts a valid tile id", () => {
    // Arrange
    vi.stubGlobal("location", { search: "?nativePlayer=tile-one" });
    // Act
    const result = nativePlayerId();
    // Assert
    expect(result).toBe("tile-one");
  });
});
