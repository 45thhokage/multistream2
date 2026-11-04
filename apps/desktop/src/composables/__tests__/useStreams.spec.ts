import { effectScope, EffectScope, nextTick, ref } from "vue";
import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from "vitest";
import { usePreferences } from "../usePreferences";
import { useStreams } from "../useStreams";
import { toast } from "@/composables/useToast";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/composables/useToast", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../useRecents", () => ({
  useRecents: () => ({
    addRecent: vi.fn(),
  }),
}));

const mockIsRecording = vi.fn((_id: string) => false);
const mockStopRecording = vi.fn((_id: string) => {});
vi.mock("../useRecording", () => ({
  useRecording: () => ({
    isRecording: mockIsRecording,
    stopRecording: mockStopRecording,
  }),
}));

const mockStreamLayoutRef = ref("auto");
vi.mock("../usePreferences", () => ({
  usePreferences: () => ({ streamLayout: mockStreamLayoutRef }),
}));

const mockWorkspacesRef = ref([{ id: "ws-test", name: "Room" }]);
const mockActiveWorkspaceIdRef = ref("ws-test");
vi.mock("../useWorkspaces", () => ({
  useWorkspaces: () => ({
    workspaces: mockWorkspacesRef,
    activeWorkspaceId: mockActiveWorkspaceIdRef,
    workspaceIdOf: (workspaceId?: string) =>
      mockWorkspacesRef.value.some((w) => w.id === workspaceId)
        ? (workspaceId as string)
        : (mockWorkspacesRef.value[0]?.id ?? "ws-test"),
  }),
}));

describe("useStreams composable unit tests", () => {
  let scope: EffectScope;
  let sut: ReturnType<typeof useStreams>;

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1600000000000));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    scope?.stop();
  });

  beforeEach(() => {
    localStorage.clear();
    mockStreamLayoutRef.value = "auto";
    vi.clearAllMocks();
    mockWorkspacesRef.value = [{ id: "ws-test", name: "Room" }];
    mockActiveWorkspaceIdRef.value = "ws-test";
    scope = effectScope();
    sut = scope.run(() => useStreams())!;
    sut.clearStreams();
    sut.resetTimerState();
  });

  it("expands Solo to Duo only after successfully adding a second stream", () => {
    // Arrange
    const preferences = scope.run(() => usePreferences());
    if (!preferences) throw new Error("missing preferences scope");
    preferences.streamLayout.value = "solo";
    sut.addStream("first", "twitch");
    // Act
    sut.addStream("first", "twitch");
    // Assert
    expect(preferences.streamLayout.value).toBe("solo");
    // Act
    sut.addStream("second", "twitch");
    // Assert
    expect(preferences.streamLayout.value).toBe("duo");
  });

  it("should add a new stream correctly", () => {
    // Arrange
    const { addStream, streams } = sut;

    // Assert (check if streams is empty)
    expect(streams.value.length).toBe(0);

    // Act
    addStream("gaules", "twitch");

    // Assert (check if stream was added)
    expect(streams.value.length).toBe(1);
    expect(streams?.value[0]?.channel).toBe("gaules");
    expect(streams?.value[0]?.platform).toBe("twitch");
    expect(streams?.value[0]?.id).toBeDefined();
  });

  it("should store displayName when provided to addStream", () => {
    // Arrange
    const { addStream, streams } = sut;

    // Act
    addStream("dQw4w9WgXcQ", "youtube", undefined, "@casimiro");

    // Assert
    expect(streams.value.length).toBe(1);
    expect(streams.value[0]?.channel).toBe("dQw4w9WgXcQ");
    expect(streams.value[0]?.platform).toBe("youtube");
    expect(streams.value[0]?.displayName).toBe("@casimiro");
  });

  it("should not add a duplicate stream", () => {
    // Arrange
    const { addStream, streams } = sut;

    // Act (first add)
    addStream("alanzoka", "twitch");

    // Assert (ensure stream was added)
    expect(streams.value.length).toBe(1);

    // Act (second add)
    addStream("alanzoka", "twitch");

    // Assert (ensure stream was not added)
    expect(streams.value.length).toBe(1);
    expect(toast.warning).toHaveBeenCalledWith("toasts.add.alreadyAdded");
  });

  it("should allow different platforms for the same channel", () => {
    // Arrange
    const { addStream, streams } = sut;

    // Act
    addStream("xqc", "twitch");
    addStream("xqc", "youtube");

    // Assert
    expect(streams.value.length).toBe(2);
  });

  it("should allow different custom streams with the same name if iframeUrls differ", () => {
    // Arrange
    const { addStream, streams } = sut;

    // Act
    addStream("Custom Stream", "custom", "https://site1.com/embed");
    addStream("Custom Stream", "custom", "https://site2.com/embed");

    // Assert
    expect(streams.value.length).toBe(2);
    expect(streams.value[0]?.iframeUrl).toBe("https://site1.com/embed");
    expect(streams.value[1]?.iframeUrl).toBe("https://site2.com/embed");
  });

  it("should prevent duplicate custom streams with the same iframeUrl", () => {
    // Arrange
    const { addStream, streams } = sut;

    // Act
    addStream("Stream 1", "custom", "https://site.com/embed");
    addStream("Stream 2", "custom", "https://site.com/embed");

    // Assert
    expect(streams.value.length).toBe(1);
    expect(toast.warning).toHaveBeenCalledWith("toasts.add.alreadyAdded");
  });

  it("should remove a stream by ID and show displayName in toast", () => {
    // Arrange
    const { addStream, removeStream, streams } = sut;

    addStream("stream1", "kick");
    addStream("dQw4w9WgXcQ", "youtube", undefined, "Batzera", "batzera1");

    // Assert (check if streams were added)
    expect(streams.value.length).toBe(2);

    // Act
    const ytStreamId = streams.value.find((s) => s.channel === "dQw4w9WgXcQ")!.id;
    removeStream(ytStreamId);

    // Assert (check if ytStream was removed and toast used displayName)
    expect(streams.value.length).toBe(1);
    expect(streams.value.find((s) => s.channel === "dQw4w9WgXcQ")).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith("Batzera toasts.remove");
  });

  it("should clear all streams", () => {
    // Arrange
    const { addStream, clearStreams, streams, requestRemoveStream, isLeaving } = sut;

    addStream("s1", "twitch");
    addStream("s2", "kick");

    // Assert (check if streams were added)
    expect(streams.value.length).toBe(2);

    const s1Id = streams.value[0]!.id;
    requestRemoveStream(s1Id);
    expect(isLeaving(s1Id)).toBe(true);

    // Act
    clearStreams();

    // Assert (check if streams were cleared and leaving is cleared)
    expect(streams.value.length).toBe(0);
    expect(isLeaving(s1Id)).toBe(false);
  });

  it("should stop background recordings when clearing all streams", () => {
    // Arrange
    const { addStream, clearStreams, streams } = sut;

    addStream("s1", "twitch");
    addStream("s2", "kick");
    const s1Id = streams.value[0]!.id;
    const s2Id = streams.value[1]!.id;

    mockIsRecording.mockImplementation((id) => id === s1Id);

    // Act
    clearStreams();

    // Assert
    expect(mockStopRecording).toHaveBeenCalledWith(s1Id);
    expect(mockStopRecording).not.toHaveBeenCalledWith(s2Id);
    expect(streams.value.length).toBe(0);
  });

  describe("two-phase removal (requestRemoveStream)", () => {
    it("should mark a stream as leaving and then remove it after delay", () => {
      const { addStream, requestRemoveStream, isLeaving, streams } = sut;

      addStream("testStream", "twitch");
      const id = streams.value[0]!.id;

      expect(isLeaving(id)).toBe(false);

      // Act: request removal
      requestRemoveStream(id);

      // Assert phase 1: marked as leaving, but still in streams
      expect(isLeaving(id)).toBe(true);
      expect(streams.value.length).toBe(1);

      // Act: advance time by 250ms
      vi.advanceTimersByTime(250);

      // Assert phase 2: stream is fully removed
      expect(isLeaving(id)).toBe(false);
      expect(streams.value.length).toBe(0);
    });

    it("should ignore duplicate requestRemoveStream calls for same stream ID", () => {
      const { addStream, requestRemoveStream, isLeaving, streams } = sut;

      addStream("testStream", "twitch");
      const id = streams.value[0]!.id;

      requestRemoveStream(id);
      expect(isLeaving(id)).toBe(true);

      // Call again - should do nothing
      requestRemoveStream(id);
      expect(isLeaving(id)).toBe(true);
    });
  });

  describe("Grid classes", () => {
    it("should return class for 1 stream", () => {
      // Arrange
      const { addStream, gridClass } = sut;

      // Act
      addStream("s1", "twitch");

      // Assert
      expect(gridClass.value).toBe("grid-cols-1 grid-rows-1");
    });

    it("should return class for 2 streams", () => {
      // Arrange
      const { addStream, gridClass } = sut;

      // Act
      addStream("s1", "twitch");
      addStream("s2", "twitch");

      // Assert
      expect(gridClass.value).toBe("grid-cols-1 grid-rows-2");
    });

    it("should return class for 3 streams", () => {
      // Arrange
      const { addStream, gridClass } = sut;

      // Act
      addStream("s1", "twitch");
      addStream("s2", "twitch");
      addStream("s3", "twitch");

      // Assert
      expect(gridClass.value).toBe("grid-cols-2 grid-rows-2");
    });

    it("should return default (4 cols / 3 rows) for more than 9 streams", () => {
      // Arrange
      const { addStream, gridClass } = sut;

      // Act
      for (let i = 0; i < 10; i++) {
        addStream(`s${i}`, "twitch");
      }

      // Assert
      expect(gridClass.value).toBe("grid-cols-4 grid-rows-3");
    });
  });

  describe("Watch time tracking logic", () => {
    beforeEach(() => {
      vi.setSystemTime(new Date(1600000000000));
    });

    it("should set sessionStartTimes on stream add", () => {
      // Arrange
      const { addStream, sessionStartTimes, streams } = sut;

      // Act
      addStream("gaules", "twitch");
      const id = streams.value[0]!.id;

      // Assert
      expect(sessionStartTimes[id]).toBe(Date.now());
    });

    it("should remove session start times on stream remove", () => {
      // Arrange
      const { addStream, removeStream, sessionStartTimes, streams } = sut;

      // Act
      addStream("gaules", "twitch");
      const id = streams.value[0]!.id;

      // Assert
      expect(sessionStartTimes[id]).toBeDefined();

      // Act
      removeStream(id);

      // Assert
      expect(sessionStartTimes[id]).toBeUndefined();
    });

    it("should accumulate historical watch time in memory and sync to storage", () => {
      // Arrange
      const { addStream, watchHistory, tick } = sut;

      addStream("gaules", "twitch");

      // Simulate 5 ticks of 1 second
      for (let i = 1; i <= 5; i++) {
        tick(1600000000000 + i * 1000);
      }

      // Verify that after 5 seconds, watch-history is NOT updated yet (since we sync every 10s)
      expect(watchHistory.value["twitch:gaules"]).toBeUndefined();

      // Simulate another 5 ticks of 1 second (10s total)
      for (let i = 6; i <= 10; i++) {
        tick(1600000000000 + i * 1000);
      }

      // Verify it has synced
      // Assert
      expect(watchHistory.value["twitch:gaules"]).toBe(10000);
    });

    it("should flush accumulated watch time immediately on stream remove", () => {
      const { addStream, removeStream, watchHistory, streams, tick } = sut;

      addStream("gaules", "twitch");
      const id = streams.value[0]!.id;

      // Simulate 3 ticks of 1 second
      for (let i = 1; i <= 3; i++) {
        tick(1600000000000 + i * 1000);
      }

      // Verify not synced yet
      expect(watchHistory.value["twitch:gaules"]).toBeUndefined();

      // Remove the stream
      removeStream(id);

      // Verify it was flushed immediately
      expect(watchHistory.value["twitch:gaules"]).toBe(3000);
    });

    it("should flush accumulated watch time immediately on clearStreams", () => {
      const { addStream, clearStreams, watchHistory, tick } = sut;

      addStream("gaules", "twitch");
      addStream("alanzoka", "twitch");

      // Simulate 4 ticks of 1 second
      for (let i = 1; i <= 4; i++) {
        tick(1600000000000 + i * 1000);
      }

      // Clear all streams
      clearStreams();

      // Verify both streams flushed their accumulated times immediately
      expect(watchHistory.value["twitch:gaules"]).toBe(4000);
      expect(watchHistory.value["twitch:alanzoka"]).toBe(4000);
    });

    it("should reactively set sessionStartTimes on backup stream overwrite/import", () => {
      const { streams, sessionStartTimes } = sut;

      // Overwrite streams directly (simulating backup import)
      streams.value = [
        { id: "imported-1", channel: "gaules", platform: "twitch" },
        { id: "imported-2", channel: "xqc", platform: "kick" },
      ];

      // Verify that watcher immediately initialized start times
      expect(sessionStartTimes["imported-1"]).toBe(1600000000000);
      expect(sessionStartTimes["imported-2"]).toBe(1600000000000);
    });

    it("should not accumulate watch time for streams that are leaving", () => {
      const { addStream, requestRemoveStream, tick, watchHistory, streams } = sut;

      addStream("gaules", "twitch");
      const id = streams.value[0]!.id;

      // Mark stream as leaving
      requestRemoveStream(id);

      // Simulate 1 tick of 1 second
      tick(1600000000000 + 1000);

      // Verify watchHistory has no entry for twitch:gaules (not accumulated)
      expect(watchHistory.value["twitch:gaules"]).toBeUndefined();
    });

    it("should track watch time separately for same-named customs with different urls", () => {
      // Arrange
      const { addStream, tick, watchHistory } = sut;

      addStream("github.com", "custom", "https://github.com/gorhill/ublock");
      addStream("github.com", "custom", "https://github.com/gorhill/");

      // Act (tick past the 10s sync interval)
      tick(1600000000000 + 11000);

      // Assert (each full url has its own accumulated entry)
      expect(watchHistory.value["custom:github.com:https://github.com/gorhill/ublock"]).toBe(11000);
      expect(watchHistory.value["custom:github.com:https://github.com/gorhill/"]).toBe(11000);
    });
  });

  describe("workspaces", () => {
    it("should assign new streams to the active workspace", () => {
      // Arrange
      const { addStream, streams, activeStreams } = sut;

      // Act
      addStream("gaules", "twitch");

      // Assert
      expect(streams.value[0]?.workspaceId).toBe("ws-test");
      expect(activeStreams.value).toHaveLength(1);
    });

    it("should allow the same channel in different workspaces but not twice in one", () => {
      // Arrange
      const { addStream, streams } = sut;
      addStream("gaules", "twitch");

      // Act
      addStream("gaules", "twitch");
      mockWorkspacesRef.value = [...mockWorkspacesRef.value, { id: "ws-b", name: "Room B" }];
      mockActiveWorkspaceIdRef.value = "ws-b";
      addStream("gaules", "twitch");

      // Assert
      expect(streams.value).toHaveLength(2);
      expect(toast.warning).toHaveBeenCalledWith("toasts.add.alreadyAdded");
    });

    it("should cap streams per workspace instead of globally", () => {
      // Arrange
      const { addStream, streams, activeStreams } = sut;
      for (let i = 0; i < 16; i++) addStream(`s${i}`, "twitch");

      // Act
      addStream("overflow", "twitch");
      mockWorkspacesRef.value = [...mockWorkspacesRef.value, { id: "ws-b", name: "Room B" }];
      mockActiveWorkspaceIdRef.value = "ws-b";
      addStream("fresh", "twitch");

      // Assert
      expect(activeStreams.value).toHaveLength(1);
      expect(activeStreams.value[0]?.channel).toBe("fresh");
      expect(streams.value).toHaveLength(17);
      expect(toast.warning).toHaveBeenCalledWith("toasts.add.maxStreams");
    });

    it("should prune streams of deleted workspaces without touching survivors", async () => {
      // Arrange
      const { addStream, streams, activeStreams } = sut;
      addStream("keep", "twitch");
      mockWorkspacesRef.value = [...mockWorkspacesRef.value, { id: "ws-b", name: "Room B" }];
      mockActiveWorkspaceIdRef.value = "ws-b";
      addStream("drop", "twitch");
      expect(streams.value).toHaveLength(2);

      // Act (simulate room deletion: metadata gone, activation back on the survivor)
      mockWorkspacesRef.value = mockWorkspacesRef.value.filter((w) => w.id !== "ws-b");
      mockActiveWorkspaceIdRef.value = "ws-test";
      await nextTick();

      // Assert
      expect(streams.value).toHaveLength(1);
      expect(streams.value[0]?.channel).toBe("keep");
      expect(activeStreams.value).toHaveLength(1);
    });
  });

  it("should allow same-named customs with different urls as separate streams", () => {
    // Arrange
    const { addStream, streams } = sut;

    // Act
    addStream("github.com", "custom", "https://github.com/gorhill/ublock");
    addStream("github.com", "custom", "https://github.com/gorhill/");

    // Assert
    expect(streams.value.length).toBe(2);
    expect(toast.warning).not.toHaveBeenCalledWith("toasts.add.alreadyAdded");
  });

  it("should reject an exact duplicate custom url", () => {
    // Arrange
    const { addStream, streams } = sut;

    // Act
    addStream("github.com", "custom", "https://github.com/gorhill/ublock");
    addStream("github.com", "custom", "https://github.com/gorhill/ublock");

    // Assert
    expect(streams.value.length).toBe(1);
    expect(toast.warning).toHaveBeenCalledWith("toasts.add.alreadyAdded");
  });

  it("should remove a stream by ID", () => {
    // Arrange
    const { addStream, removeStream, streams } = sut;

    addStream("stream1", "kick");
    addStream("stream2", "youtube");

    // Assert (check if streams were added)
    expect(streams.value.length).toBe(2);

    // Act
    const stream1Id = streams.value.find((s) => s.channel === "stream1")!.id;
    removeStream(stream1Id);

    // Assert (check if stream1 was removed)
    expect(streams.value.length).toBe(1);
    expect(streams.value.find((s) => s.channel === "stream1")).toBeUndefined();
    expect(streams.value.find((s) => s.channel === "stream2")).toBeDefined();
  });
});
