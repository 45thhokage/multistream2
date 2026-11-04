import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  onScopeDispose,
  ref,
  ssrContextKey,
} from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import NativeStreamSurface from "@/components/stream/NativeStreamSurface.vue";

const api = vi.hoisted(() => ({
  openTile: vi.fn().mockResolvedValue(true),
  closeTile: vi.fn(),
  syncTileBounds: vi.fn(),
  setTileVisible: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vueuse/core", async (original) => {
  const actual = await original<typeof import("@vueuse/core")>();
  return {
    ...actual,
    useIntervalFn: (callback: () => void, interval: number) => {
      const timer = setInterval(callback, interval);
      onScopeDispose(() => clearInterval(timer));
      return { pause: () => clearInterval(timer) };
    },
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@/composables/useBrowserTiles", () => ({ useBrowserTiles: () => api }));
vi.mock("@/composables/useStreams", () => ({
  useStreams: () => ({ streams: ref([{ id: "one", platform: "twitch" }]) }),
}));
vi.mock("@/composables/useWorkspaces", () => ({
  useWorkspaces: () => ({ workspaceIdOf: () => "main" }),
}));
vi.mock("@/composables/useStreamMixer", () => ({
  useStreamMixer: () => ({ effectiveAudio: () => ({ volume: 1, muted: false }) }),
}));

type Host = {
  parent: Host | null;
  children: Host[];
  getBoundingClientRect: () => { x: number; y: number; width: number; height: number };
};
const host = (): Host => ({
  parent: null,
  children: [],
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 640, height: 360 }),
});
const renderer = createRenderer<Host, Host>({
  createElement: host,
  createText: host,
  createComment: host,
  insert: (node, parent) => {
    node.parent = parent;
    parent.children.push(node);
  },
  remove: () => {},
  parentNode: (node) => node.parent,
  nextSibling: () => null,
  setText: () => {},
  setElementText: () => {},
  patchProp: () => {},
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("native surface lifecycle", () => {
  it("keeps a removed player muted in the graveyard until its owner unmounts", async () => {
    // Arrange
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", new EventTarget());
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const dead = ref(false);
    const app = renderer.createApp(
      defineComponent({
        setup: () => () =>
          h(NativeStreamSurface, { streamId: "one", visible: !dead.value, dead: dead.value }),
      })
    );
    app.provide(ssrContextKey, {});
    NativeStreamSurface.render = function () {
      return h("div", { ref: "viewport" });
    };
    app.mount(host());
    await nextTick();
    await vi.advanceTimersByTimeAsync(200);
    expect(api.openTile).toHaveBeenCalledTimes(1);
    // Act
    dead.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(400);
    // Assert
    expect(api.closeTile).not.toHaveBeenCalled();
    expect(api.setTileVisible).toHaveBeenCalledWith("one", false);
    expect(api.invoke).toHaveBeenCalledWith("tile_set_audio", {
      tileId: "one",
      volume: 0,
      muted: true,
    });
    expect(api.openTile).toHaveBeenCalledTimes(1);
    // Act
    app.unmount();
    // Assert
    expect(api.closeTile).toHaveBeenCalledTimes(1);
  });
});
