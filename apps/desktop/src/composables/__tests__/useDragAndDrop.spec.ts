import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ref } from "vue";
import { useDragAndDrop } from "../useDragAndDrop";
import type { Stream } from "../useStreams";

const mockStreamsRef = ref<Stream[]>([]);
const mockFocusedStreamIdRef = ref<string | null>(null);

vi.mock("../useStreams", () => ({
  useStreams: () => ({
    streams: mockStreamsRef,
  }),
}));

vi.mock("../useFocusedStream", () => ({
  useFocusedStream: () => ({
    focusedStreamId: mockFocusedStreamIdRef,
  }),
}));

const mockStreams: Stream[] = [
  { id: "stream-1", channel: "gaules", platform: "twitch" },
  { id: "stream-2", channel: "coringa", platform: "twitch" },
  { id: "stream-3", channel: "alanzoka", platform: "twitch" },
];

describe("useDragAndDrop unit tests", () => {
  let sut: ReturnType<typeof useDragAndDrop>;

  beforeEach(() => {
    sut = useDragAndDrop();

    // Arrange: Reset mocked state
    mockStreamsRef.value = [...mockStreams];
    mockFocusedStreamIdRef.value = null;
    sut.onGlobalMouseUp();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Mouse Events - Drag Start", () => {
    it("should set draggingId on mousedown", () => {
      // Act
      sut.onMouseDown("stream-1");

      // Assert
      expect(sut.draggingId.value).toBe("stream-1");
      expect(sut.isDragging.value).toBe(true);
    });
  });

  describe("Mouse Events - Hover", () => {
    it("should set overId on mouseenter if dragging", () => {
      // Arrange
      sut.onMouseDown("stream-1");

      // Act
      sut.onMouseEnter("stream-2");

      // Assert
      expect(sut.overId.value).toBe("stream-2");
    });

    it("should not set overId on mouseenter if not dragging", () => {
      // Act
      sut.onMouseEnter("stream-2");

      // Assert
      expect(sut.overId.value).toBeNull();
    });

    it("should clear overId on mouseleave", () => {
      // Arrange
      sut.onMouseDown("stream-1");
      sut.onMouseEnter("stream-2");

      // Act
      sut.onMouseLeave();

      // Assert
      expect(sut.overId.value).toBeNull();
    });
  });

  describe("Mouse Events - Drop (mouseup)", () => {
    it("should do nothing if mouseup when not dragging", () => {
      // Act
      sut.onMouseUp("stream-2");

      // Assert
      expect(mockStreamsRef.value).toEqual(mockStreams);
    });

    it("should do nothing if mouseup on self", () => {
      // Arrange
      sut.onMouseDown("stream-1");
      sut.onMouseEnter("stream-1");

      // Act
      sut.onMouseUp("stream-1");

      // Assert
      expect(mockStreamsRef.value).toEqual(mockStreams);
      expect(sut.draggingId.value).toBeNull();
    });

    it("should do nothing if overId is null when mouseup fires", () => {
      // Arrange
      sut.onMouseDown("stream-1");

      // Act - mouseup without entering another stream
      sut.onMouseUp("stream-1");

      // Assert
      expect(mockStreamsRef.value).toEqual(mockStreams);
    });

    it("should swap two streams when mouseup on a valid target", () => {
      // Arrange
      sut.onMouseDown("stream-1");
      sut.onMouseEnter("stream-3");

      // Act
      sut.onMouseUp("stream-3");

      // Assert
      const streams = mockStreamsRef.value;
      expect(streams[0]!.id).toBe("stream-3");
      expect(streams[1]!.id).toBe("stream-2");
      expect(streams[2]!.id).toBe("stream-1");
      expect(sut.draggingId.value).toBeNull();
    });

    it("should swap focusedStreamId if the dragged stream was focused", () => {
      // Arrange
      mockFocusedStreamIdRef.value = "stream-1";
      sut.onMouseDown("stream-1");
      sut.onMouseEnter("stream-2");

      // Act
      sut.onMouseUp("stream-2");

      // Assert
      expect(mockFocusedStreamIdRef.value).toBe("stream-2");
      expect(mockStreamsRef.value[0]!.id).toBe("stream-2");
      expect(mockStreamsRef.value[1]!.id).toBe("stream-1");
    });

    it("should swap focusedStreamId if the target stream was focused", () => {
      // Arrange
      mockFocusedStreamIdRef.value = "stream-2";
      sut.onMouseDown("stream-1");
      sut.onMouseEnter("stream-2");

      // Act
      sut.onMouseUp("stream-2");

      // Assert
      expect(mockFocusedStreamIdRef.value).toBe("stream-1");
      expect(mockStreamsRef.value[0]!.id).toBe("stream-2");
      expect(mockStreamsRef.value[1]!.id).toBe("stream-1");
    });

    it("should not touch focusedStreamId if neither dragged nor target were focused", () => {
      // Arrange
      mockFocusedStreamIdRef.value = "stream-3";
      sut.onMouseDown("stream-1");
      sut.onMouseEnter("stream-2");

      // Act
      sut.onMouseUp("stream-2");

      // Assert
      expect(mockFocusedStreamIdRef.value).toBe("stream-3");
    });
  });

  describe("Global mouseup cleanup", () => {
    it("should clear dragging state on global mouseup", () => {
      // Arrange
      sut.onMouseDown("stream-1");
      sut.onMouseEnter("stream-2");

      // Act
      sut.onGlobalMouseUp();

      // Assert
      expect(sut.draggingId.value).toBeNull();
      expect(sut.overId.value).toBeNull();
      expect(sut.isDragging.value).toBe(false);
    });
  });
  describe("Empty slots and cancelling", () => {
    it("should pin the dragged stream to the empty slot it was dropped on", () => {
      // Arrange
      sut.onMouseDown("stream-1");
      sut.onSlotEnter(5);

      // Act
      sut.onSlotMouseUp();

      // Assert
      expect(mockStreamsRef.value.map((s) => s.id)).toEqual(["stream-2", "stream-3", "stream-1"]);
      expect(mockStreamsRef.value[2]?.slot).toBe(5);
      expect(sut.isDragging.value).toBe(false);
      expect(sut.overSlot.value).toBeNull();
    });

    it("should keep the other tiles where they are when a tile moves to an empty slot", () => {
      // Arrange: quad layout, three tiles filling slots 0-2, slot 3 empty
      const slots: Record<string, number> = { "stream-1": 0, "stream-2": 1, "stream-3": 2 };
      const slotOf = (id: string) => slots[id];
      sut.onMouseDown("stream-1");
      sut.onSlotEnter(3);

      // Act
      sut.onSlotMouseUp(slotOf);

      // Assert: stream-2/3 stay pinned on their tiles instead of sliding into the vacated slot 0
      const pins = Object.fromEntries(mockStreamsRef.value.map((s) => [s.id, s.slot]));
      expect(pins).toEqual({ "stream-1": 3, "stream-2": 1, "stream-3": 2 });
    });

    it("should leave the order alone when released outside any slot", () => {
      // Arrange
      sut.onMouseDown("stream-1");
      sut.onSlotEnter(5);
      sut.onSlotLeave();

      // Act
      sut.onSlotMouseUp();

      // Assert
      expect(mockStreamsRef.value.map((s) => s.id)).toEqual(["stream-1", "stream-2", "stream-3"]);
    });

    it("should highlight one kind of target at a time", () => {
      // Arrange
      sut.onMouseDown("stream-1");

      // Act
      sut.onMouseEnter("stream-2");
      sut.onSlotEnter(4);

      // Assert
      expect(sut.overId.value).toBeNull();
      expect(sut.overSlot.value).toBe(4);
    });

    it("should cancel a drag without changing the order", () => {
      // Arrange
      sut.onMouseDown("stream-1");
      sut.onMouseEnter("stream-2");

      // Act
      sut.cancelDrag();
      sut.onMouseUp("stream-2");

      // Assert
      expect(mockStreamsRef.value.map((s) => s.id)).toEqual(["stream-1", "stream-2", "stream-3"]);
      expect(sut.isDragging.value).toBe(false);
    });
  });

  describe("Drag threshold", () => {
    beforeEach(() => {
      vi.stubGlobal("window", new EventTarget());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    const press = (x: number, y: number) => ({ clientX: x, clientY: y }) as MouseEvent;
    const move = (x: number, y: number) =>
      window.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: x, clientY: y }));

    it("should not start a drag from a press that barely moves or is released", () => {
      // Arrange
      sut.beginDragOnMove("stream-1", press(100, 100));

      // Act
      move(102, 101);
      window.dispatchEvent(new Event("mouseup"));
      move(200, 200);

      // Assert
      expect(sut.isDragging.value).toBe(false);
    });

    it("should forget a press whose release the page never saw", () => {
      // Arrange: pressed on a grip, released over a native tile (no mouseup reaches the page)
      sut.beginDragOnMove("stream-1", press(100, 100));

      // Act: later the pointer moves over the page with no button held
      window.dispatchEvent(
        Object.assign(new Event("mousemove"), { clientX: 300, clientY: 300, buttons: 0 })
      );
      window.dispatchEvent(
        Object.assign(new Event("mousemove"), { clientX: 400, clientY: 400, buttons: 1 })
      );

      // Assert
      expect(sut.isDragging.value).toBe(false);
    });

    it("should start the drag once the pointer has moved far enough", () => {
      // Arrange
      sut.beginDragOnMove("stream-1", press(100, 100));

      // Act
      move(110, 100);

      // Assert
      expect(sut.draggingId.value).toBe("stream-1");
    });
  });
});
