/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, it, expect, vi } from "vitest";

const source = readFileSync(
  new URL("../../../src-tauri/src/core/quality.js", import.meta.url),
  "utf8"
);
function harness(player?: object, embedded = false) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const reports: { detail: { current: string; failed?: boolean; options: unknown[] } }[] = [];
  const root = {
    __reactContainer$test: {
      child: { stateNode: { props: { mediaPlayerInstance: { playerInstance: player } } } },
    },
  };
  const win = {
    top: null as unknown,
    addEventListener: (name: string, cb: (event: unknown) => void) => {
      listeners[name] = cb;
    },
    dispatchEvent: (event: (typeof reports)[number]) => reports.push(event),
  };
  win.top = embedded ? {} : win;
  Object.assign(win, {
    parent: {
      postMessage: (data: { report: (typeof reports)[number]["detail"] }) =>
        reports.push({ detail: data.report }),
    },
  });
  runInNewContext(source, {
    window: win,
    document: {
      querySelector: (selector: string) => (selector === "#root" ? root : null),
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener: () => {},
    },
    location: { hostname: "player.twitch.tv" },
    CustomEvent: class {
      type: string;
      detailArg: { detail: unknown };
      constructor(type: string, detailArg: { detail: unknown }) {
        this.type = type;
        this.detailArg = detailArg;
      }
      get detail() {
        return this.detailArg.detail;
      }
    },
    setInterval: () => 0,
    setTimeout,
    Date,
  });
  return {
    reports,
    request: (quality: string) =>
      listeners.message?.({ data: { type: "MULTISTREAM_QUALITY_REQUEST", quality }, source: win }),
  };
}

describe("injected Twitch quality control", () => {
  it("finds a player behind React class props and switches without navigation", async () => {
    // Arrange
    let current = "chunked";
    const player = {
      getQualities: () => [{ group: "chunked" }, { group: "720p60", height: 720, fps: 60 }],
      getQuality: () => current,
      setAutoQualityMode: vi.fn(),
      setQuality: vi.fn((id: string) => {
        current = id;
      }),
    };
    const bridge = harness(player);
    // Act
    bridge.request("720p60");
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Assert
    expect(player.setAutoQualityMode).toHaveBeenCalledWith(false);
    expect(player.setQuality).toHaveBeenCalledWith("720p60", true);
    expect(bridge.reports.at(-1)?.detail.current).toBe("720p60");
    expect(bridge.reports.at(-1)?.detail.failed).toBeUndefined();
  });
});

afterEach(() => vi.useRealTimers());
describe("Twitch quality API variants", () => {
  it("passes rendition objects to the IVS player even on a Twitch hostname", async () => {
    // Arrange
    const levels = [
      { name: "1080p60", height: 1080 },
      { name: "720p60", height: 720 },
    ];
    let current = levels[0];
    const player = {
      getQualities: () => levels,
      getQuality: () => current,
      setQuality: vi.fn((quality: typeof current) => {
        current = quality;
      }),
    };
    const bridge = harness(player);
    // Act
    bridge.request("720p60");
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Assert
    expect(player.setQuality).toHaveBeenCalledWith(levels[1], true);
    expect(bridge.reports.at(-1)?.detail.current).toBe("720p60");
    expect(bridge.reports.at(-1)?.detail.failed).toBeUndefined();
  });
  it("supports players exposing string rendition IDs", async () => {
    // Arrange
    let current = "chunked";
    const player = {
      getQualities: () => ["chunked", "720p60"],
      getQuality: () => current,
      setQuality: vi.fn((quality: string) => {
        current = quality;
      }),
    };
    const bridge = harness(player);
    // Act
    bridge.request("720p60");
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Assert
    expect(player.setQuality).toHaveBeenCalledWith("720p60", true);
    expect(bridge.reports.at(-1)?.detail.current).toBe("720p60");
  });
  it("does not report failure from an embedded frame without a player", async () => {
    // Arrange
    vi.useFakeTimers();
    const bridge = harness(undefined, true);
    // Act
    bridge.request("720p60");
    await vi.advanceTimersByTimeAsync(6000);
    // Assert
    expect(bridge.reports).toEqual([]);
  });
  it("still reports failure when the owning player rejects a rendition", async () => {
    // Arrange
    vi.useFakeTimers();
    const player = {
      getQualities: () => ["chunked", "720p60"],
      getQuality: () => "chunked",
      setQuality: vi.fn(),
    };
    const bridge = harness(player);
    // Act
    bridge.request("720p60");
    await vi.advanceTimersByTimeAsync(6000);
    // Assert
    expect(bridge.reports.at(-1)?.detail.failed).toBe(true);
    expect(bridge.reports.at(-1)?.detail.current).toBe("chunked");
  });
});
