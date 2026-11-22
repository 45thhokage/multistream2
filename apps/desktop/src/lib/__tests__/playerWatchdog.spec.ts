/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi, afterEach } from "vitest";

const source = readFileSync(
  new URL("../../../src-tauri/src/core/player_watchdog.js", import.meta.url),
  "utf8"
);

function harness(
  options: { host?: string; store?: Map<string, string>; noStorage?: boolean } = {}
) {
  const store = options.store ?? new Map<string, string>();
  const events = new Map<string, (...args: any[]) => void>();
  const reload = vi.fn();
  const media = { paused: false, readyState: 0, currentTime: 0 };
  const win: any = {
    location: {
      hostname: options.host ?? "player.kick.cx",
      pathname: "/xqc",
      search: "",
      reload,
    },
    __isGraveyard: false,
  };
  Object.defineProperty(win, "sessionStorage", {
    get() {
      if (options.noStorage) throw new Error("denied");
      return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      };
    },
  });
  runInNewContext(source, {
    window: win,
    URLSearchParams,
    Number,
    String,
    Date,
    setInterval,
    clearInterval,
    document: {
      querySelector: () => media,
      addEventListener: (name: string, fn: (...args: any[]) => void) => events.set(name, fn),
      removeEventListener: (name: string) => events.delete(name),
    },
  });
  return { media, win, reload, store, events };
}

afterEach(() => vi.useRealTimers());

describe("player stall watchdog", () => {
  it("reloads a player that never starts and backs off between attempts", async () => {
    // Arrange
    vi.useFakeTimers();
    const store = new Map<string, string>();
    const first = harness({ store });
    // Act
    await vi.advanceTimersByTimeAsync(20000);
    // Assert
    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(store.get("multistream-stall:player.kick.cx/xqc:")).toBe("1");
    // Act: the reloaded page waits longer before its next attempt
    const second = harness({ store });
    await vi.advanceTimersByTimeAsync(20000);
    expect(second.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20000);
    // Assert
    expect(second.reload).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded number of reloads", async () => {
    // Arrange
    vi.useFakeTimers();
    const store = new Map([["multistream-stall:player.kick.cx/xqc:", "3"]]);
    const sut = harness({ store });
    // Act
    await vi.advanceTimersByTimeAsync(120000);
    // Assert
    expect(sut.reload).not.toHaveBeenCalled();
  });

  it("leaves a healthy player alone and clears earlier retries", async () => {
    // Arrange
    vi.useFakeTimers();
    const store = new Map([["multistream-stall:player.kick.cx/xqc:", "1"]]);
    const sut = harness({ store });
    sut.media.readyState = 4;
    // Act
    for (let i = 0; i < 20; i++) {
      sut.media.currentTime += 2;
      await vi.advanceTimersByTimeAsync(2000);
    }
    // Assert
    expect(sut.reload).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("treats a pause after real playback as the viewer's choice", async () => {
    // Arrange
    vi.useFakeTimers();
    const sut = harness();
    sut.media.readyState = 4;
    sut.media.currentTime = 5;
    await vi.advanceTimersByTimeAsync(2000);
    // Act
    sut.media.paused = true;
    await vi.advanceTimersByTimeAsync(120000);
    // Assert
    expect(sut.reload).not.toHaveBeenCalled();
  });

  it("stops on manual interaction and for suspended graveyard players", async () => {
    // Arrange
    vi.useFakeTimers();
    const touched = harness();
    const dead = harness();
    dead.win.__isGraveyard = true;
    // Act
    touched.events.get("pointerdown")?.({ isTrusted: true });
    await vi.advanceTimersByTimeAsync(120000);
    // Assert
    expect(touched.reload).not.toHaveBeenCalled();
    expect(dead.reload).not.toHaveBeenCalled();
  });

  it("ignores other hosts and never reloads without a persisted counter", async () => {
    // Arrange
    vi.useFakeTimers();
    const other = harness({ host: "example.com" });
    const blocked = harness({ noStorage: true });
    // Act
    await vi.advanceTimersByTimeAsync(120000);
    // Assert
    expect(other.reload).not.toHaveBeenCalled();
    expect(blocked.reload).not.toHaveBeenCalled();
  });
});
