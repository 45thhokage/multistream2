import { describe, it, expect } from "vitest";
import {
  arrangeCustomStreams,
  arrangeStreams,
  autoGridDims,
  clampGridSize,
  getLayoutDef,
  gridDimensionsFromContainer,
  isCustomLayoutId,
  isLayoutId,
  LAYOUTS,
  getLayoutSlots,
  compileLayout,
  isOverlaySlot,
  customLayoutSlots,
  LAYOUT_IDS,
  orderStreamsForLayout,
  resolveLayout,
  type CustomLayoutDef,
  type LayoutId,
} from "../layouts";
import type { Stream } from "@/composables/useStreams";

function makeStreams(count: number): Stream[] {
  // Arrange helper: build N deterministic streams
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    channel: `channel${i}`,
    platform: "twitch" as const,
  }));
}

describe("layouts config unit tests", () => {
  describe("reference geometry", () => {
    it("should keep every preset inside the frame and fill it without gaps outside PiP", () => {
      // Arrange
      const presets = LAYOUTS.filter((layout) => layout.id !== "auto");

      // Act
      const invalid = presets.filter((layout) =>
        layout.slots.some(
          (slot) =>
            slot.x < 0 ||
            slot.y < 0 ||
            slot.w <= 0 ||
            slot.h <= 0 ||
            slot.x + slot.w > 1.000001 ||
            slot.y + slot.h > 1.000001
        )
      );

      // Assert
      expect(presets).toHaveLength(34);
      expect(invalid.map((layout) => layout.id)).toEqual([]);
      for (const layout of presets.filter((layout) => layout.group !== "pip")) {
        expect(layout.slots.reduce((area, slot) => area + slot.w * slot.h, 0)).toBeCloseTo(1, 5);
        expect(layout.slots.some((slot, index) => isOverlaySlot(slot, index, layout.slots))).toBe(
          false
        );
      }
    });

    it("should place empty focus panes on the right in the same cells as occupied panes", () => {
      // Arrange
      const slots = getLayoutSlots("focus");

      // Act
      const partial = arrangeStreams("focus", makeStreams(1), null);
      const full = arrangeStreams("focus", makeStreams(3), null);

      // Assert
      expect(slots).toEqual([
        { x: 0, y: 0, w: 0.72, h: 1 },
        { x: 0.72, y: 0, w: 0.28, h: 0.5 },
        { x: 0.72, y: 0.5, w: 0.28, h: 0.5 },
      ]);
      expect(partial.emptyPlacements.map((slot) => slot.style)).toEqual([
        full.placedById["id-1"]?.style,
        full.placedById["id-2"]?.style,
      ]);
    });

    it("should restore a fixed layout after overflow is removed", () => {
      // Arrange
      const streams = makeStreams(5);

      // Act
      const expanded = arrangeStreams("duo", streams, null);
      const restored = arrangeStreams("duo", streams.slice(0, 2), null);

      // Assert
      expect(expanded.expanded).toBe(true);
      expect(Object.values(expanded.placedById).filter((stream) => !stream.hidden)).toHaveLength(5);
      expect(restored.expanded).toBe(false);
      expect(restored.container.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    });

    it("should retain an intentional solo view and move the focused stream into it", () => {
      // Arrange
      const streams = makeStreams(5);

      // Act
      const solo = arrangeStreams("solo", streams, "id-4");

      // Assert
      expect(solo.expanded).toBe(false);
      expect(
        Object.values(solo.placedById)
          .filter((stream) => !stream.hidden)
          .map((stream) => stream.id)
      ).toEqual(["id-4"]);
      expect(Object.keys(solo.placedById)).toHaveLength(5);
    });

    it("should preserve opposite-corner PiP geometry and stacking when the main stream changes", () => {
      // Arrange
      const slots = getLayoutSlots("pip-2-corners");

      // Act
      const compiled = compileLayout(slots);
      const arranged = arrangeStreams("pip-2-corners", makeStreams(3), "id-2");

      // Assert
      expect(slots[0]).toEqual({ x: 0, y: 0, w: 1, h: 1 });
      expect(slots[1]).toMatchObject({ x: 0.015, y: 0.72, w: 0.25, h: 0.25 });
      expect(slots[2]).toMatchObject({ x: 0.735, y: 0.72, w: 0.25, h: 0.25 });
      expect(compiled.placements.map((slot) => slot.style.zIndex)).toEqual(["0", "2", "3"]);
      expect(arranged.placedById["id-2"]?.style.zIndex).toBe("0");
      expect(arranged.placedById["id-0"]?.style.zIndex).toBe("2");
    });

    it("should render saved focus and PiP geometry exactly while supporting legacy grids", () => {
      // Arrange
      const slots = getLayoutSlots("pip-2-corners");
      const saved = { id: "custom-pip", name: "My PiP", cols: 2, rows: 2, slots };

      // Act
      const original = arrangeStreams("pip-2-corners", makeStreams(3), null);
      const restored = arrangeCustomStreams(saved, makeStreams(3), null);

      // Assert
      expect(restored).toEqual(original);
      expect(customLayoutSlots({ id: "custom-old", name: "Old", cols: 2, rows: 2 })).toHaveLength(
        4
      );
      expect(
        customLayoutSlots({ ...saved, slots: [{ x: 0, y: 0, w: Number.NaN, h: 1 }] })
      ).toHaveLength(4);
    });
  });
  describe("isLayoutId() / resolveLayout()", () => {
    it("should accept every registered layout id", () => {
      // Arrange
      const ids: unknown[] = [...LAYOUT_IDS];

      // Act
      const results = ids.map((id) => isLayoutId(id));

      // Assert
      expect(results.every(Boolean)).toBe(true);
      expect(LAYOUTS).toHaveLength(35);
    });

    it("should fall back to quad for unknown or missing values", () => {
      // Arrange
      const candidates = ["grid", "", null, undefined, 42];

      // Act
      const resolved = candidates.map((c) => resolveLayout(c));

      // Assert
      expect(resolved.every((r) => r === "quad")).toBe(true);
    });
  });

  describe("orderStreamsForLayout()", () => {
    it("should move the focused stream first without dropping any stream", () => {
      // Arrange
      const streams = makeStreams(3);

      // Act
      const ordered = orderStreamsForLayout(streams, "id-2");

      // Assert
      expect(ordered.map((s) => s.id)).toEqual(["id-2", "id-0", "id-1"]);
    });

    it("should keep insertion order when nothing is focused", () => {
      // Arrange
      const streams = makeStreams(3);

      // Act
      const ordered = orderStreamsForLayout(streams, null);

      // Assert
      expect(ordered.map((s) => s.id)).toEqual(["id-0", "id-1", "id-2"]);
    });
  });

  describe("arrangeStreams()", () => {
    it("should expand an undersized quad to keep every stream visible", () => {
      // Arrange
      const streams = makeStreams(6);

      // Act
      const arranged = arrangeStreams("quad", streams, null);

      // Assert
      const visible = Object.values(arranged.placedById).filter((p) => !p.hidden);
      const hidden = Object.values(arranged.placedById).filter((p) => p.hidden);
      expect(visible).toHaveLength(6);
      expect(hidden).toHaveLength(0);
      expect(Object.keys(arranged.placedById)).toHaveLength(6);
      expect(arranged.container.display).toBe("grid");
    });

    it("should give every stream an explicit grid cell so DOM order never changes", () => {
      // Arrange
      const streams = makeStreams(4);

      // Act
      const arranged = arrangeStreams("quad", streams, "id-3");

      // Assert
      expect(arranged.mainId).toBe("id-3");
      expect(arranged.placedById["id-3"]?.style).toMatchObject({
        gridColumn: "1 / 2",
        gridRow: "1 / 2",
      });
      expect(arranged.placedById["id-0"]?.style).toMatchObject({
        gridColumn: "2 / 3",
        gridRow: "1 / 2",
      });
    });

    it("should place the focused stream in the main slot of the focus layout", () => {
      // Arrange
      const streams = makeStreams(3);

      // Act
      const arranged = arrangeStreams("focus", streams, "id-1");

      // Assert
      expect(arranged.mainId).toBe("id-1");
      expect(arranged.placedById["id-1"]?.style.gridColumn).toBe("1 / 2");
      expect(arranged.container.gridTemplateColumns).toBe("minmax(0, 720fr) minmax(0, 280fr)");
    });

    it("should stack PiP panes above a full-frame main pane without moving nodes", () => {
      // Arrange
      const streams = makeStreams(2);

      // Act
      const arranged = arrangeStreams("pip", streams, null);

      // Assert
      expect(arranged.overlay).toBe(true);
      expect(arranged.placedById["id-0"]?.style.zIndex).toBe("0");
      expect(arranged.placedById["id-1"]?.style.zIndex).toBe("2");
      expect(arranged.placedById["id-1"]?.overlayIndex).toBe(0);
      expect(arranged.placedById["id-1"]?.hidden).toBe(false);
    });

    it("should keep theater minis on the second row under a full-width main", () => {
      // Arrange
      const streams = makeStreams(3);

      // Act
      const arranged = arrangeStreams("theater", streams, null);

      // Assert
      expect(arranged.placedById["id-0"]?.style.gridRow).toBe("1 / 2");
      expect(arranged.placedById["id-1"]?.style).toMatchObject({ gridRow: "2 / 3" });
      expect(arranged.placedById["id-2"]?.style).toMatchObject({ gridRow: "2 / 3" });
    });

    it("should mark every def with a label key and a positive slot cap", () => {
      // Arrange
      const defs = LAYOUTS.map((l) => getLayoutDef(l.id as LayoutId));

      // Act
      const valid = defs.every(
        (d) => typeof d.labelKey === "string" && d.maxVisible >= 1 && d.slots.length > 0
      );

      // Assert
      expect(valid).toBe(true);
    });

    it("should size the auto grid from the stream count so every video gets its own tile", () => {
      // Arrange
      const cases: [number, { cols: number; rows: number }][] = [
        [0, { cols: 1, rows: 1 }],
        [1, { cols: 1, rows: 1 }],
        [2, { cols: 2, rows: 1 }],
        [3, { cols: 3, rows: 1 }],
        [4, { cols: 2, rows: 2 }],
        [5, { cols: 3, rows: 2 }],
        [6, { cols: 3, rows: 2 }],
        [9, { cols: 3, rows: 3 }],
        [12, { cols: 4, rows: 3 }],
      ];

      // Act
      const results = cases.map(([count]) => autoGridDims(count));

      // Assert
      expect(results).toEqual(cases.map(([, dims]) => dims));
    });

    it("should never hide streams in auto layout and report leftover cells as empty slots", () => {
      // Arrange
      const streams = makeStreams(5);

      // Act
      const arranged = arrangeStreams("auto", streams, null);

      // Assert
      const visible = Object.values(arranged.placedById).filter((p) => !p.hidden);
      expect(visible).toHaveLength(5);
      expect(arranged.container.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
      expect(arranged.container.gridTemplateRows).toBe("repeat(2, minmax(0, 1fr))");
      expect(arranged.emptySlots).toBe(1);
    });

    it("should report zero empty slots for focus layouts and full grids", () => {
      // Arrange
      const focusStreams = makeStreams(3);
      const quadStreams = makeStreams(4);

      // Act
      const focus = arrangeStreams("focus", focusStreams, null);
      const quad = arrangeStreams("quad", quadStreams, null);

      // Assert
      expect(focus.emptySlots).toBe(0);
      expect(quad.emptySlots).toBe(0);
    });

    it("should keep quad as a 2x2 grid with placeholders when fewer than 4 streams exist", () => {
      // Arrange
      const streams = makeStreams(2);

      // Act
      const arranged = arrangeStreams("quad", streams, null);

      // Assert
      expect(arranged.container.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
      expect(arranged.container.gridTemplateRows).toBe("repeat(2, minmax(0, 1fr))");
      expect(arranged.emptySlots).toBe(2);
      expect(arranged.placedById["id-0"]?.style).toMatchObject({
        gridColumn: "1 / 2",
        gridRow: "1 / 2",
      });
      expect(arranged.placedById["id-1"]?.style).toMatchObject({
        gridColumn: "2 / 3",
        gridRow: "1 / 2",
      });
    });

    it("should not stretch the last stream in a partially filled quad", () => {
      // Arrange
      const streams = makeStreams(3);

      // Act
      const arranged = arrangeStreams("quad", streams, null);

      // Assert
      expect(arranged.placedById["id-2"]?.style).toMatchObject({
        gridColumn: "1 / 2",
        gridRow: "2 / 3",
      });
      expect(arranged.placedById["id-2"]?.spanLastOdd).toBe(false);
      expect(arranged.emptySlots).toBe(1);
    });

    it("should keep fixed shapes for duo, stack, wide, tall, and wall", () => {
      // Arrange
      const one = makeStreams(1);
      const two = makeStreams(2);

      // Act
      const duo = arrangeStreams("duo", one, null);
      const stack = arrangeStreams("stack", one, null);
      const wide = arrangeStreams("wide", one, null);
      const tall = arrangeStreams("tall", two, null);
      const wall = arrangeStreams("wall", two, null);

      // Assert
      expect(duo.container.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
      expect(duo.emptySlots).toBe(1);
      expect(stack.container.gridTemplateRows).toBe("repeat(2, minmax(0, 1fr))");
      expect(stack.emptySlots).toBe(1);
      expect(wide.container.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
      expect(wide.emptySlots).toBe(2);
      expect(tall.container.gridTemplateRows).toBe("repeat(3, minmax(0, 1fr))");
      expect(tall.emptySlots).toBe(1);
      expect(wall.container.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
      expect(wall.container.gridTemplateRows).toBe("repeat(2, minmax(0, 1fr))");
      expect(wall.emptySlots).toBe(4);
    });

    it("should keep theater at 3 columns with correctly placed empty mini panes", () => {
      // Arrange
      const streams = makeStreams(2);

      // Act
      const arranged = arrangeStreams("theater", streams, null);

      // Assert
      expect(arranged.container.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
      expect(arranged.placedById["id-0"]?.style.gridColumn).toBe("1 / 4");
      expect(arranged.emptySlots).toBe(2);
    });
  });

  describe("custom layouts", () => {
    const def: CustomLayoutDef = { id: "custom-abc", name: "Custom 2x2", cols: 2, rows: 2 };

    it("should detect custom layout ids by prefix", () => {
      // Arrange
      const values: unknown[] = ["custom-abc", "quad", "", null, 42];

      // Act
      const results = values.map(isCustomLayoutId);

      // Assert
      expect(results).toEqual([true, false, false, false, false]);
    });

    it("should clamp grid sizes into the supported range", () => {
      // Arrange
      const values = [0, -3, 2.7, 4, 99, Number.NaN];

      // Act
      const results = values.map(clampGridSize);

      // Assert
      expect(results).toEqual([1, 1, 2, 4, 6, 1]);
    });

    it("should read grid dimensions from container templates", () => {
      // Arrange
      const containers = [
        {
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gridTemplateRows: "repeat(3, minmax(0, 1fr))",
        },
        { gridTemplateColumns: "25% 75%", gridTemplateRows: "repeat(1, minmax(0, 1fr))" },
        {
          gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)",
          gridTemplateRows: "minmax(0, 3fr) minmax(0, 1fr)",
        },
      ];

      // Act
      const results = containers.map(gridDimensionsFromContainer);

      // Assert
      expect(results).toEqual([
        { cols: 2, rows: 3 },
        { cols: 2, rows: 1 },
        { cols: 2, rows: 2 },
      ]);
    });

    it("should expand a saved grid when its capacity is exceeded", () => {
      // Arrange
      const streams = makeStreams(6);

      // Act
      const arranged = arrangeCustomStreams(def, streams, null);

      // Assert
      expect(arranged.container.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
      expect(arranged.placedById["id-0"]?.style).toMatchObject({
        gridColumn: "1 / 2",
        gridRow: "1 / 2",
      });
      expect(arranged.placedById["id-3"]?.style).toMatchObject({
        gridColumn: "1 / 2",
        gridRow: "2 / 3",
      });
      expect(arranged.placedById["id-4"]?.hidden).toBe(false);
      expect(arranged.placedById["id-5"]?.hidden).toBe(false);
      expect(arranged.mainId).toBe("id-0");
    });

    it("should order focused streams first", () => {
      // Arrange
      const streams = makeStreams(3);

      // Act
      const arranged = arrangeCustomStreams(def, streams, "id-2");

      // Assert
      expect(arranged.mainId).toBe("id-2");
      expect(arranged.placedById["id-2"]?.style).toMatchObject({
        gridColumn: "1 / 2",
        gridRow: "1 / 2",
      });
    });

    it("should report unfilled custom cells as empty slots", () => {
      // Arrange
      const streams = makeStreams(3);

      // Act
      const arranged = arrangeCustomStreams(def, streams, null);

      // Assert
      expect(arranged.emptySlots).toBe(1);
    });
  });
});
