import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reloadApp, forceReloadApp } from "../reloadApp";

describe("reloadApp unit tests", () => {
  const reload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { location: { reload }, caches: undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should reload the whole application", () => {
    // Arrange
    // window stub with location.reload in beforeEach

    // Act
    reloadApp();

    // Assert
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("should clear every cache entry before reloading on force reload", async () => {
    // Arrange
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("window", {
      location: { reload },
      caches: { keys: vi.fn().mockResolvedValue(["v1", "v2"]), delete: cacheDelete },
    });

    // Act
    await forceReloadApp();

    // Assert
    expect(cacheDelete).toHaveBeenCalledTimes(2);
    expect(cacheDelete).toHaveBeenCalledWith("v1");
    expect(cacheDelete).toHaveBeenCalledWith("v2");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("should still reload when cache clearing fails", async () => {
    // Arrange
    vi.stubGlobal("window", {
      location: { reload },
      caches: { keys: vi.fn().mockRejectedValue(new Error("denied")), delete: vi.fn() },
    });

    // Act
    await forceReloadApp();

    // Assert
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("should reload directly when cache storage is unavailable", async () => {
    // Arrange
    // window stub without caches in beforeEach

    // Act
    await forceReloadApp();

    // Assert
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
