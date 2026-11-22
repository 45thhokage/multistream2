import { describe, expect, it } from "vitest";
import { compileLayout, customLayoutSlots, gridSlots } from "../layouts";
import {
  followNeighbours,
  gridRects,
  hostIndex,
  neighboursOf,
  nextPipRect,
  normalizeSlots,
  overlayFlags,
  resizeRect,
  splitTile,
  uncoveredRects,
} from "../layoutEditorModel";

const FRAME = 16 / 9;
const PIP = { size: 0.25, frameAspect: FRAME, inset: 0.015 };
const noSnap = { lines: { xs: [], ys: [] }, threshold: { x: 0, y: 0 }, enabled: false };

describe("layout editor model", () => {
  it("drags a shared edge as one line: both neighbours follow, nothing tears open", () => {
    // Arrange: "large + 2 small" — the large tile's right edge is the small tiles' left edge
    const slots = [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
    const n = neighboursOf(slots, 0);

    // Act: pull the large tile's right edge to 60%
    const { rect } = resizeRect(slots[0]!, "e", 0.1, 0, { ...noSnap });
    const follow = followNeighbours(slots, n, slots[0]!, rect);

    // Assert
    expect(rect.w).toBeCloseTo(0.6);
    expect(follow.get(1)).toEqual({ x: 0.6, y: 0, w: expect.closeTo(0.4), h: 0.5 });
    expect(follow.get(2)).toEqual({ x: 0.6, y: 0.5, w: expect.closeTo(0.4), h: 0.5 });
    expect(uncoveredRects([rect, follow.get(1)!, follow.get(2)!])).toEqual([]);
  });

  it("splitting a tile keeps the frame covered and hands its PiP to the part holding it", () => {
    // Arrange: one full tile with a PiP bottom-right
    const pip = nextPipRect([{ x: 0, y: 0, w: 1, h: 1 }], 0, PIP);
    const slots = [{ x: 0, y: 0, w: 1, h: 1 }, pip];

    // Act
    const { slots: next } = splitTile(slots, 0, "cols", 2, FRAME);

    // Assert: two halves, and the PiP still floats, now on the right half
    expect(next).toHaveLength(3);
    expect(overlayFlags(next)).toEqual([false, false, true]);
    expect(hostIndex(next, 2)).toBe(1);
    expect(uncoveredRects(next.slice(0, 2))).toEqual([]);
  });

  it("finds the empty parts of the frame", () => {
    // Act
    const gaps = uncoveredRects([{ x: 0, y: 0, w: 0.5, h: 1 }]);

    // Assert
    expect(gaps).toEqual([{ x: 0.5, y: 0, w: 0.5, h: 1 }]);
  });

  it("tidies drifted edges so the grid compiles to clean tracks", () => {
    // Arrange: thirds that drifted by float noise and a pixel
    const drifted = [
      { x: 0, y: 0, w: 0.3334, h: 1 },
      { x: 0.3333, y: 0, w: 0.33336, h: 1 },
      { x: 0.6667, y: 0, w: 0.3333, h: 1 },
    ];

    // Act
    const clean = normalizeSlots(drifted);

    // Assert: exact thirds, so the grid has three equal tracks
    expect(clean.map((s) => s.x)).toEqual([0, 1 / 3, 2 / 3]);
    expect(compileLayout(clean).container.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  });

  it("an edited layout is accepted as a saved custom layout", () => {
    // Arrange
    const slots = normalizeSlots([...gridRects(2, 1), nextPipRect(gridRects(2, 1), 0, PIP)]);

    // Act
    const loaded = customLayoutSlots({ id: "custom-x", name: "x", cols: 2, rows: 1, slots });

    // Assert: the saved slots are used as-is, not replaced by the fallback grid
    expect(loaded).toEqual(slots);
    expect(loaded).not.toEqual(gridSlots(2, 1));
  });
});
