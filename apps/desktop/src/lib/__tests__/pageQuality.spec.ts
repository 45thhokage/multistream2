/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";

const source = readFileSync(
  new URL("../../../src-tauri/src/core/quality.js", import.meta.url),
  "utf8"
);
function harness(player: object) {
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
  win.top = win;
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
