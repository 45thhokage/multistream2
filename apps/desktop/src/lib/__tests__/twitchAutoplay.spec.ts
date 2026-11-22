/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi, afterEach } from "vitest";
const source = readFileSync(
  new URL("../../../src-tauri/src/core/player_autoplay.js", import.meta.url),
  "utf8"
);
function harness(
  options: { host?: string; graveyard?: boolean; play?: ReturnType<typeof vi.fn> } = {}
) {
  const events = new Map<string, (...args: any[]) => void>();
  let mutate = () => {};
  const media = {
    play: options.play || vi.fn().mockResolvedValue(undefined),
    muted: false,
    paused: true,
    ended: false,
    readyState: 0,
    currentTime: 0,
    currentSrc: "",
    parentElement: null,
  };
  const win = {
    location: {
      hostname: options.host || "player.twitch.tv",
      search: "?autoplay=true&muted=false",
    },
    __isGraveyard: options.graveyard || false,
    player: undefined as any,
  };
  const disconnect = vi.fn();
  const state = {
    overlay: null as null | { disabled?: boolean; click: () => void },
    roots: [] as any[],
  };
  runInNewContext(source, {
    window: win,
    URLSearchParams,
    WeakSet,
    WeakMap,
    Set,
    Date,
    Object,
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
    MutationObserver: class {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
    document: {
      querySelector: (selector: string) => (selector === "video" ? media : state.overlay),
      querySelectorAll: () => state.roots,
      documentElement: {},
      addEventListener: (name: string, fn: (...args: any[]) => void) => events.set(name, fn),
      removeEventListener: (name: string) => events.delete(name),
    },
  });
  return { media, win, events, disconnect, state, mutate };
}
afterEach(() => vi.useRealTimers());
describe("platform startup playback", () => {
  it("starts before buffering, but only finishes after playback actually advances", async () => {
    // Arrange
    vi.useFakeTimers();
    const sut = harness();
    // Act
    await Promise.resolve();
    expect(sut.events.size).toBeGreaterThan(0);
    sut.media.paused = false;
    sut.media.readyState = 4;
    sut.media.currentTime = 1;
    await vi.advanceTimersByTimeAsync(500);
    // Assert
    expect(sut.media.play).toHaveBeenCalledTimes(1);
    expect(sut.events.size).toBe(0);
  });
  it("keeps the muted fallback instead of immediately re-triggering an audible autoplay block", async () => {
    // Arrange
    vi.useFakeTimers();
    const play = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(Error("blocked"), { name: "NotAllowedError" }))
      .mockResolvedValue(undefined);
    const sut = harness({ play });
    // Act
    await vi.advanceTimersByTimeAsync(500);
    // Assert
    expect(play).toHaveBeenCalledTimes(2);
    expect(sut.media.muted).toBe(true);
  });
  it("never restarts a suspended graveyard player", async () => {
    // Arrange
    vi.useFakeTimers();
    const sut = harness({ graveyard: true });
    // Act
    await vi.advanceTimersByTimeAsync(1000);
    // Assert
    expect(sut.media.play).not.toHaveBeenCalled();
    expect(sut.disconnect).toHaveBeenCalled();
  });
  it("respects manual interaction before playback starts", async () => {
    // Arrange
    vi.useFakeTimers();
    const sut = harness({ play: vi.fn().mockRejectedValue(Error("not ready")) });
    // Act
    await vi.advanceTimersByTimeAsync(1000);
    sut.events.get("pointerdown")?.({ isTrusted: true });
    const calls = sut.media.play.mock.calls.length;
    await vi.advanceTimersByTimeAsync(40000);
    // Assert
    expect(sut.media.play).toHaveBeenCalledTimes(calls);
    expect(sut.events.size).toBe(0);
  });
  it("bounds retries when no playable source arrives", async () => {
    // Arrange
    vi.useFakeTimers();
    const sut = harness({ play: vi.fn().mockRejectedValue(Error("not ready")) });
    // Act
    await vi.advanceTimersByTimeAsync(30000);
    const calls = sut.media.play.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    // Assert
    expect(sut.media.play).toHaveBeenCalledTimes(calls);
    expect(sut.events.size).toBe(0);
  });
  it("activates a late Twitch Play overlay even when an empty video has a pending play promise", async () => {
    // Arrange
    vi.useFakeTimers();
    const sut = harness({ play: vi.fn(() => new Promise(() => {})) });
    const click = vi.fn(() => {
      sut.events.get("pointerdown")?.({ isTrusted: false });
      sut.state.overlay = null;
      sut.media.currentSrc = "blob:stream";
      sut.media.paused = false;
      sut.media.readyState = 4;
    });
    // Act
    sut.state.overlay = { click };
    sut.mutate();
    sut.media.currentTime = 1;
    await vi.advanceTimersByTimeAsync(500);
    // Assert
    expect(click).toHaveBeenCalledTimes(1);
    expect(sut.state.overlay).toBeNull();
    expect(sut.events.size).toBe(0);
  });
  it("starts a Kick IVS controller held in a React ref", async () => {
    // Arrange
    vi.useFakeTimers();
    const sut = harness({ host: "player.kick.cx" });
    const play = vi.fn(() => {
      sut.media.currentSrc = "blob:kick";
      sut.media.paused = false;
      sut.media.readyState = 4;
    });
    sut.state.roots = [
      {
        __reactFiber$test: {
          memoizedState: { memoizedState: { current: { getState: () => "IDLE", play } } },
        },
      },
    ];
    // Act
    await vi.advanceTimersByTimeAsync(1000);
    sut.media.currentTime = 2;
    await vi.advanceTimersByTimeAsync(500);
    // Assert
    expect(play).toHaveBeenCalledTimes(1);
    expect(sut.events.size).toBe(0);
  });
});
