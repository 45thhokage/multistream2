/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";

const source = readFileSync(
  new URL("../../../src-tauri/src/core/graveyard.js", import.meta.url),
  "utf8"
);
describe("native player graveyard", () => {
  it("suspends nested players once and prevents late media from restarting", async () => {
    // Arrange
    let listener: (event: unknown) => void = () => {};
    const media = { muted: false, volume: 1, pause: vi.fn(), removeAttribute: vi.fn() };
    const child = { contentWindow: { postMessage: vi.fn() } };
    const win = {
      parent: null as unknown,
      addEventListener: (_: string, fn: typeof listener) => {
        listener = fn;
      },
    };
    win.parent = win;
    const Media = class {
      play() {
        return Promise.resolve();
      }
    };
    const observe = vi.fn();
    runInNewContext(source, {
      window: win,
      HTMLMediaElement: Media,
      document: {
        querySelectorAll: (selector: string) => (selector === "iframe" ? [child] : [media]),
        addEventListener: vi.fn(),
        documentElement: {},
      },
      MutationObserver: class {
        observe = observe;
      },
    });
    const event = { source: win, data: { type: "MULTISTREAM_GRAVEYARD_SUSPEND" } };
    // Act
    listener(event);
    listener(event);
    await new Media().play();
    // Assert
    expect(media.muted).toBe(true);
    expect(media.volume).toBe(0);
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(child.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
  });
});
