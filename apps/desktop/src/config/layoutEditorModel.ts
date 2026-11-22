import { isOverlaySlot, type LayoutSlot } from "./layouts";

/**
 * The geometry behind the layout editor's free-form canvas.
 *
 * Adapted from Multi Worldview's `core/layouts/editorModel.ts` (MIT, see
 * docs/third-party-layouts.txt). The editor is a canvas of rectangles, not a grid of cells to
 * paint: a slot is moved by dragging it, sized by its handles, split into columns or rows, and a
 * picture-in-picture is dropped *into* the tile it floats on. Everything those gestures decide
 * lives here, free of Vue and the DOM, so it can be checked without a running app. The component
 * supplies pointer deltas in frame fractions and gets rects back.
 */

type Rect = LayoutSlot;

/** Smallest difference that counts as a change: float noise, not a decision. */
const EPS = 1e-6;

/** The smallest a slot may get on either axis, as a fraction of the frame. */
export const MIN_SLOT = 0.04;

/** Where a free (unsnapped) edge lands: a half-percent lattice keeps numbers readable. */
export const FINE_STEP = 0.005;

/** A video's own shape: what "keep 16:9" means for a PiP. */
export const VIDEO_ASPECT = 16 / 9;

/** The most of its tile a PiP may cover on either axis before it is shrunk to fit. */
export const PIP_MAX_SHARE = 0.9;

/** A resize handle: the edges it moves. */
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Nine places a PiP can sit inside its host: corners, edge midpoints, centre. */
export type Anchor = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";
export const ANCHORS: readonly Anchor[] = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];

/** An alignment line the editor draws while an edge is snapped to it. */
export interface Guide {
  /** `x`: a vertical line at `at`; `y`: a horizontal one. */
  axis: "x" | "y";
  at: number;
}

/** The lines a moving edge may snap to, per axis. */
export interface SnapLines {
  xs: number[];
  ys: number[];
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Which slots float on a bigger one (PiPs). Same rule the grid draws with. */
export function overlayFlags(slots: readonly Rect[]): boolean[] {
  const list = [...slots];
  return list.map((slot, index) => isOverlaySlot(slot, index, list));
}

/** Slots in paint order with every overlay last: the array order is the z-order. */
export function orderSlotsBaseFirst(slots: readonly Rect[]): Rect[] {
  const overlays = overlayFlags(slots);
  const base: Rect[] = [];
  const pip: Rect[] = [];
  slots.forEach((slot, index) => (overlays[index] ? pip : base).push(slot));
  return [...base, ...pip];
}

// ---------------------------------------------------------------------------
// Hit testing and structure
// ---------------------------------------------------------------------------

/** The slot under a point in the frame, or -1. Later slots win: they are drawn on top. */
export function slotAtPoint(slots: readonly Rect[], x: number, y: number): number {
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i]!;
    if (x > s.x - EPS && x < s.x + s.w + EPS && y > s.y - EPS && y < s.y + s.h + EPS) return i;
  }
  return -1;
}

/** The tile a slot floats on: the smallest non-overlay slot holding its centre, or -1. */
export function hostIndex(
  slots: readonly Rect[],
  index: number,
  overlays = overlayFlags(slots)
): number {
  const slot = slots[index];
  if (!slot || !overlays[index]) return -1;
  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h / 2;
  let best = -1;
  let bestArea = Infinity;
  slots.forEach((s, i) => {
    if (i === index || overlays[i]) return;
    if (cx < s.x - EPS || cx > s.x + s.w + EPS || cy < s.y - EPS || cy > s.y + s.h + EPS) return;
    const area = s.w * s.h;
    if (area < bestArea) {
      best = i;
      bestArea = area;
    }
  });
  return best;
}

/** The overlays floating on the tile at `host`. */
export function childrenOf(slots: readonly Rect[], host: number): number[] {
  const overlays = overlayFlags(slots);
  const out: number[] = [];
  slots.forEach((_, i) => {
    if (overlays[i] && hostIndex(slots, i, overlays) === host) out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/**
 * The lines a dragged slot may align to: the frame's edges and centre, and every other slot's
 * edges and centre. A PiP being dragged also gets each tile's inset lines.
 */
export function snapLines(
  slots: readonly Rect[],
  exclude: ReadonlySet<number>,
  pipInsetXY?: { x: number; y: number }
): SnapLines {
  const xs = [0, 0.5, 1];
  const ys = [0, 0.5, 1];
  const overlays = overlayFlags(slots);
  slots.forEach((s, i) => {
    if (exclude.has(i)) return;
    xs.push(s.x, s.x + s.w, s.x + s.w / 2);
    ys.push(s.y, s.y + s.h, s.y + s.h / 2);
    if (pipInsetXY && !overlays[i]) {
      xs.push(s.x + pipInsetXY.x, s.x + s.w - pipInsetXY.x);
      ys.push(s.y + pipInsetXY.y, s.y + s.h - pipInsetXY.y);
    }
  });
  return { xs, ys };
}

function nearestSnap(
  edges: readonly number[],
  lines: readonly number[],
  threshold: number
): { shift: number; at: number } | null {
  let best: { shift: number; at: number } | null = null;
  for (const edge of edges) {
    for (const line of lines) {
      const shift = line - edge;
      if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift) - EPS))
        best = { shift, at: line };
    }
  }
  return best;
}

export interface SnapOptions {
  lines: SnapLines;
  /** How close an edge has to come to a line to snap, per axis (frame fractions). */
  threshold: { x: number; y: number };
  /** False (Alt held, or snapping switched off): only the fine lattice applies. */
  enabled: boolean;
}

/** An edge that has not really moved stays exactly where it was; others land on the lattice. */
function freeValue(value: number, original: number | undefined): number {
  if (original !== undefined && Math.abs(value - original) < FINE_STEP / 2) return original;
  return roundTo(value, FINE_STEP);
}

/** Where a slot dragged to `rect` lands: its own size, snapped, and always inside the frame. */
export function snapMove(
  rect: Rect,
  options: SnapOptions,
  origin?: Rect
): { rect: Rect; guides: Guide[] } {
  const guides: Guide[] = [];
  let { x, y } = rect;
  const sx = options.enabled
    ? nearestSnap([x, x + rect.w, x + rect.w / 2], options.lines.xs, options.threshold.x)
    : null;
  if (sx) {
    x += sx.shift;
    guides.push({ axis: "x", at: sx.at });
  } else {
    x = freeValue(x, origin?.x);
  }
  const sy = options.enabled
    ? nearestSnap([y, y + rect.h, y + rect.h / 2], options.lines.ys, options.threshold.y)
    : null;
  if (sy) {
    y += sy.shift;
    guides.push({ axis: "y", at: sy.at });
  } else {
    y = freeValue(y, origin?.y);
  }
  return {
    rect: { x: clamp(x, 0, 1 - rect.w), y: clamp(y, 0, 1 - rect.h), w: rect.w, h: rect.h },
    guides,
  };
}

function snapEdge(
  value: number,
  original: number,
  options: SnapOptions,
  guides: Guide[],
  axis: "x" | "y"
): number {
  const lines = axis === "x" ? options.lines.xs : options.lines.ys;
  const threshold = axis === "x" ? options.threshold.x : options.threshold.y;
  const hit = options.enabled ? nearestSnap([value], lines, threshold) : null;
  if (hit) {
    guides.push({ axis, at: hit.at });
    return hit.at;
  }
  return freeValue(value, original);
}

/** How far each edge of a slot may travel while resizing (the room its neighbours leave). */
export interface EdgeLimits {
  minLeft: number;
  maxLeft: number;
  minRight: number;
  maxRight: number;
  minTop: number;
  maxTop: number;
  minBottom: number;
  maxBottom: number;
}

const NO_LIMITS: EdgeLimits = {
  minLeft: 0,
  maxLeft: 1,
  minRight: 0,
  maxRight: 1,
  minTop: 0,
  maxTop: 1,
  minBottom: 0,
  maxBottom: 1,
};

export interface ResizeOptions extends SnapOptions {
  /** Keep the slot's shape (w / h in frame fractions) from a corner handle. */
  aspect?: number;
  limits?: EdgeLimits;
}

/**
 * The rect a slot resized by `handle` lands on. Only the edges the handle names move; each
 * snaps on its own. A slot never gets smaller than `MIN_SLOT` and never leaves its limits.
 */
export function resizeRect(
  origin: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  options: ResizeOptions
): { rect: Rect; guides: Guide[] } {
  const guides: Guide[] = [];
  const limits = options.limits ?? NO_LIMITS;
  let left = origin.x;
  let right = origin.x + origin.w;
  let top = origin.y;
  let bottom = origin.y + origin.h;
  if (handle.includes("w")) {
    left = snapEdge(origin.x + dx, origin.x, options, guides, "x");
    left = clamp(left, limits.minLeft, Math.min(limits.maxLeft, right - MIN_SLOT));
  }
  if (handle.includes("e")) {
    right = snapEdge(origin.x + origin.w + dx, origin.x + origin.w, options, guides, "x");
    right = clamp(right, Math.max(limits.minRight, left + MIN_SLOT), limits.maxRight);
  }
  if (handle.includes("n")) {
    top = snapEdge(origin.y + dy, origin.y, options, guides, "y");
    top = clamp(top, limits.minTop, Math.min(limits.maxTop, bottom - MIN_SLOT));
  }
  if (handle.includes("s")) {
    bottom = snapEdge(origin.y + origin.h + dy, origin.y + origin.h, options, guides, "y");
    bottom = clamp(bottom, Math.max(limits.minBottom, top + MIN_SLOT), limits.maxBottom);
  }
  if (options.aspect && options.aspect > 0) {
    const ratio = options.aspect;
    const horizontal = handle.includes("e") || handle.includes("w");
    const vertical = handle.includes("n") || handle.includes("s");
    let w = right - left;
    let h = bottom - top;
    if (horizontal) h = w / ratio;
    else if (vertical) w = h * ratio;
    const roomW = handle.includes("w") ? right - limits.minLeft : limits.maxRight - left;
    const roomH = handle.includes("n") ? bottom - limits.minTop : limits.maxBottom - top;
    const scale = Math.min(1, roomW / w, roomH / h);
    w *= scale;
    h *= scale;
    if (w < MIN_SLOT || h < MIN_SLOT) {
      const grow = Math.max(MIN_SLOT / w, MIN_SLOT / h);
      w *= grow;
      h *= grow;
    }
    if (handle.includes("w")) left = right - w;
    else right = left + w;
    if (handle.includes("n")) top = bottom - h;
    else if (handle.includes("s") || horizontal) bottom = top + h;
    if (!horizontal) {
      const cx = origin.x + origin.w / 2;
      left = clamp(cx - w / 2, 0, 1 - w);
      right = left + w;
    }
    if (!vertical) {
      const cy = origin.y + origin.h / 2;
      top = clamp(cy - h / 2, 0, 1 - h);
      bottom = top + h;
    }
    guides.length = 0;
  }
  return { rect: { x: left, y: top, w: right - left, h: bottom - top }, guides };
}

// ---------------------------------------------------------------------------
// Shared edges: a line between tiles moves as one, like a splitter
// ---------------------------------------------------------------------------

const ON_LINE = 1e-4;

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - EPS && b0 < a1 - EPS;
}

/** One edge of a tile, and every other tile with an edge on the same line that moves with it. */
export interface EdgeGroup {
  axis: "x" | "y";
  at: number;
  tiles: number[];
}

export interface Neighbours {
  left: EdgeGroup;
  right: EdgeGroup;
  top: EdgeGroup;
  bottom: EdgeGroup;
}

const startOf = (s: Rect, axis: "x" | "y") => (axis === "x" ? s.x : s.y);
const endOf = (s: Rect, axis: "x" | "y") => (axis === "x" ? s.x + s.w : s.y + s.h);

function alongLine(a: Rect, b: Rect, axis: "x" | "y", touching: boolean): boolean {
  const [a0, a1, b0, b1] =
    axis === "x" ? [a.y, a.y + a.h, b.y, b.y + b.h] : [a.x, a.x + a.w, b.x, b.x + b.w];
  return touching ? a0 <= b1 + ON_LINE && b0 <= a1 + ON_LINE : rangesOverlap(a0, a1, b0, b1);
}

/**
 * Every tile that moves when one edge of `index` is dragged: the group grows from the dragged
 * tile across the line and back, through every tile touching it edge to edge along the line.
 * A corner drag (`touching`) moves the whole straight line.
 */
function edgeGroup(
  slots: readonly Rect[],
  overlays: readonly boolean[],
  index: number,
  axis: "x" | "y",
  side: "start" | "end",
  touching: boolean
): EdgeGroup {
  const s = slots[index]!;
  const at = side === "start" ? startOf(s, axis) : endOf(s, axis);
  const group: EdgeGroup = { axis, at, tiles: [] };
  if (at <= ON_LINE || at >= 1 - ON_LINE) return group;
  const startsOn = (o: Rect) => Math.abs(startOf(o, axis) - at) < ON_LINE;
  const endsOn = (o: Rect) => Math.abs(endOf(o, axis) - at) < ON_LINE;
  const mine = new Set([index]);
  const across = new Set<number>();
  const onMySide = side === "start" ? startsOn : endsOn;
  const onOtherSide = side === "start" ? endsOn : startsOn;
  let grew = true;
  while (grew) {
    grew = false;
    slots.forEach((o, i) => {
      if (overlays[i] || mine.has(i) || across.has(i)) return;
      if (onOtherSide(o) && [...mine].some((m) => alongLine(slots[m]!, o, axis, touching))) {
        across.add(i);
        grew = true;
      } else if (onMySide(o) && [...across].some((m) => alongLine(slots[m]!, o, axis, touching))) {
        mine.add(i);
        grew = true;
      }
    });
  }
  mine.delete(index);
  group.tiles = [...across, ...mine];
  return group;
}

/** The tiles that move with each edge of a tile. Overlays have none: a PiP floats. */
const noEdge = (axis: "x" | "y"): EdgeGroup => ({ axis, at: -1, tiles: [] });

export function neighboursOf(slots: readonly Rect[], index: number, corner = false): Neighbours {
  const overlays = overlayFlags(slots);
  const s = slots[index];
  if (!s || overlays[index]) {
    return { left: noEdge("x"), right: noEdge("x"), top: noEdge("y"), bottom: noEdge("y") };
  }
  return {
    left: edgeGroup(slots, overlays, index, "x", "start", corner),
    right: edgeGroup(slots, overlays, index, "x", "end", corner),
    top: edgeGroup(slots, overlays, index, "y", "start", corner),
    bottom: edgeGroup(slots, overlays, index, "y", "end", corner),
  };
}

export function neighbourTiles(n: Neighbours): number[] {
  return [...new Set([...n.left.tiles, ...n.right.tiles, ...n.top.tiles, ...n.bottom.tiles])];
}

function groupRange(slots: readonly Rect[], g: EdgeGroup): [number, number] {
  let lo = 0;
  let hi = 1;
  for (const i of g.tiles) {
    const o = slots[i]!;
    if (Math.abs(startOf(o, g.axis) - g.at) < ON_LINE)
      hi = Math.min(hi, endOf(o, g.axis) - MIN_SLOT);
    else lo = Math.max(lo, startOf(o, g.axis) + MIN_SLOT);
  }
  return [lo, hi];
}

export function neighbourLimits(slots: readonly Rect[], n: Neighbours): EdgeLimits {
  const [minLeft, maxLeft] = groupRange(slots, n.left);
  const [minRight, maxRight] = groupRange(slots, n.right);
  const [minTop, maxTop] = groupRange(slots, n.top);
  const [minBottom, maxBottom] = groupRange(slots, n.bottom);
  return { minLeft, maxLeft, minRight, maxRight, minTop, maxTop, minBottom, maxBottom };
}

/** The other tiles' rects after the dragged one went from `before` to `after`. */
export function followNeighbours(
  slots: readonly Rect[],
  n: Neighbours,
  before: Rect,
  after: Rect
): Map<number, Rect> {
  const out = new Map<number, Rect>();
  const move = (g: EdgeGroup, to: number) => {
    for (const i of g.tiles) {
      const original = slots[i]!;
      const o = out.get(i) ?? original;
      const atStart = Math.abs(startOf(original, g.axis) - g.at) < ON_LINE;
      if (g.axis === "x")
        out.set(i, atStart ? { ...o, x: to, w: o.x + o.w - to } : { ...o, w: to - o.x });
      else out.set(i, atStart ? { ...o, y: to, h: o.y + o.h - to } : { ...o, h: to - o.y });
    }
  };
  if (Math.abs(after.x - before.x) > EPS) move(n.left, after.x);
  if (Math.abs(after.x + after.w - (before.x + before.w)) > EPS) move(n.right, after.x + after.w);
  if (Math.abs(after.y - before.y) > EPS) move(n.top, after.y);
  if (Math.abs(after.y + after.h - (before.y + before.h)) > EPS) move(n.bottom, after.y + after.h);
  return out;
}

// ---------------------------------------------------------------------------
// PiPs that ride along with their host
// ---------------------------------------------------------------------------

/** Where a PiP goes when its host moves or is resized: it keeps its nearest corner/edge/centre. */
export function carryWithHost(pip: Rect, before: Rect, after: Rect): Rect {
  const scale = Math.min(1, (after.w * PIP_MAX_SHARE) / pip.w, (after.h * PIP_MAX_SHARE) / pip.h);
  const w = pip.w * scale;
  const h = pip.h * scale;
  const along = (
    p0: number,
    size: number,
    b0: number,
    bSize: number,
    a0: number,
    aSize: number,
    newSize: number
  ) => {
    const startGap = p0 - b0;
    const endGap = b0 + bSize - (p0 + size);
    const centre = p0 + size / 2 - (b0 + bSize / 2);
    const third = bSize / 3;
    let next: number;
    if (Math.abs(centre) < third / 2 && Math.abs(startGap - endGap) < third)
      next = a0 + aSize / 2 + centre - newSize / 2;
    else if (startGap <= endGap) next = a0 + startGap;
    else next = a0 + aSize - endGap - newSize;
    return clamp(next, a0, a0 + aSize - newSize);
  };
  return {
    x: along(pip.x, pip.w, before.x, before.w, after.x, after.w, w),
    y: along(pip.y, pip.h, before.y, before.h, after.y, after.h, h),
    w,
    h,
  };
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export function splitRect(rect: Rect, axis: "cols" | "rows", n: number): Rect[] {
  const count = Math.max(1, Math.floor(n));
  return Array.from({ length: count }, (_, i) =>
    axis === "cols"
      ? { x: rect.x + (rect.w * i) / count, y: rect.y, w: rect.w / count, h: rect.h }
      : { x: rect.x, y: rect.y + (rect.h * i) / count, w: rect.w, h: rect.h / count }
  );
}

export function gridRects(cols: number, rows: number, area: Rect = { x: 0, y: 0, w: 1, h: 1 }) {
  return splitRect(area, "rows", rows).flatMap((row) => splitRect(row, "cols", cols));
}

export interface PipOptions {
  /** The PiP's width as a fraction of its host's width. */
  size: number;
  /** The frame's own shape (width / height in pixels), so a 16:9 PiP looks 16:9. */
  frameAspect: number;
  /** Margin from the host's edge, as a fraction of the frame's width. */
  inset: number;
}

export function pipInset(inset: number, frameAspect: number): { x: number; y: number } {
  return { x: inset, y: inset * frameAspect };
}

export function videoHeightFor(w: number, frameAspect: number): number {
  return (w * frameAspect) / VIDEO_ASPECT;
}

/** A 16:9 picture-in-picture rect inside `host`, at one of nine anchors. */
export function pipInHost(host: Rect, anchor: Anchor, options: PipOptions): Rect {
  const inset = pipInset(options.inset, options.frameAspect);
  const maxW = Math.max(MIN_SLOT, host.w - 2 * inset.x);
  const maxH = Math.max(MIN_SLOT, host.h - 2 * inset.y);
  let w = clamp(options.size, 0.05, 1) * host.w;
  let h = videoHeightFor(w, options.frameAspect);
  const scale = Math.min(1, maxW / w, maxH / h);
  w = Math.max(MIN_SLOT, w * scale);
  h = Math.max(MIN_SLOT, h * scale);
  const col = anchor[1];
  const row = anchor[0];
  const x =
    col === "l"
      ? host.x + inset.x
      : col === "r"
        ? host.x + host.w - inset.x - w
        : host.x + (host.w - w) / 2;
  const y =
    row === "t"
      ? host.y + inset.y
      : row === "b"
        ? host.y + host.h - inset.y - h
        : host.y + (host.h - h) / 2;
  return {
    x: roundTo(clamp(x, 0, 1 - w), 0.001),
    y: roundTo(clamp(y, 0, 1 - h), 0.001),
    w: roundTo(w, 0.001),
    h: roundTo(h, 0.001),
  };
}

/** The anchor a PiP is nearest to inside its host. */
export function anchorOf(pip: Rect, host: Rect): Anchor {
  const fx = (pip.x + pip.w / 2 - host.x) / host.w;
  const fy = (pip.y + pip.h / 2 - host.y) / host.h;
  const col = fx < 1 / 3 ? "l" : fx > 2 / 3 ? "r" : "c";
  const row = fy < 1 / 3 ? "t" : fy > 2 / 3 ? "b" : "m";
  return `${row}${col}` as Anchor;
}

/**
 * How far a PiP may be pulled from `from` towards `proposed` and still float. A PiP enlarged
 * past every tile it covers stops being the thing on top, so it stops at the largest step that
 * keeps it floating; `limited` says it was held back.
 */
export function keepFloating(
  slots: readonly Rect[],
  index: number,
  proposed: Rect,
  from: Rect
): { rect: Rect; limited: boolean } {
  const floats = (r: Rect) => {
    const area = r.w * r.h;
    return slots.some(
      (s, i) =>
        i !== index &&
        s.w * s.h > area + 1e-9 &&
        r.x < s.x + s.w &&
        s.x < r.x + r.w &&
        r.y < s.y + s.h &&
        s.y < r.y + r.h
    );
  };
  if (floats(proposed) || !floats(from)) return { rect: proposed, limited: false };
  const at = (t: number): Rect => ({
    x: from.x + (proposed.x - from.x) * t,
    y: from.y + (proposed.y - from.y) * t,
    w: from.w + (proposed.w - from.w) * t,
    h: from.h + (proposed.h - from.h) * t,
  });
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (floats(at(mid))) lo = mid;
    else hi = mid;
  }
  let t = lo;
  while (t > 0 && !floats(at(Math.max(0, t - 0.01)))) t -= 0.01;
  return { rect: at(Math.max(0, t - 0.01)), limited: true };
}

/** A PiP given a new width (and its 16:9 height) without leaving where it is. */
export function resizePipInPlace(pip: Rect, host: Rect, width: number, frameAspect: number): Rect {
  let w = Math.max(MIN_SLOT, width);
  let h = videoHeightFor(w, frameAspect);
  const scale = Math.min(1, (host.w * PIP_MAX_SHARE) / w, (host.h * PIP_MAX_SHARE) / h);
  w *= scale;
  h *= scale;
  const anchor = anchorOf(pip, host);
  const col = anchor[1];
  const row = anchor[0];
  const x = col === "l" ? pip.x : col === "r" ? pip.x + pip.w - w : pip.x + pip.w / 2 - w / 2;
  const y = row === "t" ? pip.y : row === "b" ? pip.y + pip.h - h : pip.y + pip.h / 2 - h / 2;
  return {
    x: roundTo(clamp(x, host.x, host.x + host.w - w), 0.001),
    y: roundTo(clamp(y, host.y, host.y + host.h - h), 0.001),
    w: roundTo(w, 0.001),
    h: roundTo(h, 0.001),
  };
}

/**
 * A tile cut into equal parts, with the PiPs floating on it handed to the part that holds each
 * one's centre (shrunk if that part is too small to keep it floating).
 */
export function splitTile(
  slots: readonly Rect[],
  index: number,
  axis: "cols" | "rows",
  n: number,
  frameAspect: number
): { slots: Rect[]; parts: Rect[] } {
  const parts = splitRect(slots[index]!, axis, n);
  const kids = new Set(childrenOf(slots, index));
  const out: Rect[] = [];
  slots.forEach((s, i) => {
    if (i === index) {
      out.push(...parts);
      return;
    }
    if (!kids.has(i)) {
      out.push(s);
      return;
    }
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const part =
      parts.find(
        (p) => cx >= p.x - EPS && cx <= p.x + p.w + EPS && cy >= p.y - EPS && cy <= p.y + p.h + EPS
      ) ?? parts[0]!;
    const fits = s.w <= part.w * 0.6 && s.h <= part.h * 0.6;
    const w = fits ? s.w : Math.min(s.w, part.w * 0.5);
    const placed = fits
      ? {
          ...s,
          x: clamp(s.x, part.x, part.x + part.w - s.w),
          y: clamp(s.y, part.y, part.y + part.h - s.h),
        }
      : resizePipInPlace(s, part, w, frameAspect);
    out.push(placed);
  });
  return { slots: out, parts };
}

const PIP_PREFERENCE: readonly Anchor[] = ["br", "bl", "tr", "tl", "mr", "ml", "bc", "tc", "mc"];

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS
  );
}

/** Where the next PiP in a host goes: the first free anchor (corners first). */
export function nextPipRect(slots: readonly Rect[], host: number, options: PipOptions): Rect {
  const hostRect = slots[host]!;
  const others = childrenOf(slots, host).map((i) => slots[i]!);
  for (const anchor of PIP_PREFERENCE) {
    const rect = pipInHost(hostRect, anchor, options);
    if (!others.some((o) => overlaps(o, rect))) return rect;
  }
  const base = pipInHost(hostRect, "br", options);
  const gap = pipInset(options.inset, options.frameAspect).y;
  let y = base.y;
  while (others.some((o) => overlaps(o, { ...base, y })) && y - base.h - gap >= hostRect.y)
    y -= base.h + gap;
  return { ...base, y: roundTo(y, 0.001) };
}

/** Several PiPs in a row along the bottom of a host, evenly spaced. */
export function pipStrip(host: Rect, count: number, options: PipOptions): Rect[] {
  const n = Math.max(1, Math.floor(count));
  const inset = pipInset(options.inset, options.frameAspect);
  const room = host.w - inset.x * (n + 1);
  const w = Math.min(options.size * host.w, room / n);
  const h = Math.min(videoHeightFor(w, options.frameAspect), host.h - 2 * inset.y);
  const total = w * n + inset.x * (n - 1);
  const x0 = host.x + host.w - inset.x - total;
  const y = host.y + host.h - inset.y - h;
  return Array.from({ length: n }, (_, i) => ({
    x: roundTo(x0 + i * (w + inset.x), 0.001),
    y: roundTo(y, 0.001),
    w: roundTo(w, 0.001),
    h: roundTo(h, 0.001),
  }));
}

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

function boundaries(slots: readonly Rect[], axis: "x" | "y"): number[] {
  const values = [0, 1];
  for (const s of slots) values.push(s[axis], s[axis] + (axis === "x" ? s.w : s.h));
  return [...new Set(values.map((v) => Math.round(v * 1e6) / 1e6))]
    .filter((v) => v >= 0 && v <= 1)
    .toSorted((a, b) => a - b);
}

/** The parts of the frame no slot covers, merged into as few rectangles as a greedy pass finds. */
export function uncoveredRects(slots: readonly Rect[]): Rect[] {
  const xs = boundaries(slots, "x");
  const ys = boundaries(slots, "y");
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const empty: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = (xs[c]! + xs[c + 1]!) / 2;
      const cy = (ys[r]! + ys[r + 1]!) / 2;
      const thin = xs[c + 1]! - xs[c]! < EPS || ys[r + 1]! - ys[r]! < EPS;
      row.push(!thin && slotAtPoint(slots, cx, cy) < 0);
    }
    empty.push(row);
  }
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!empty[r]![c]) continue;
      let c1 = c;
      while (c1 + 1 < cols && empty[r]![c1 + 1]) c1++;
      let r1 = r;
      const rowFree = (rr: number) => {
        for (let cc = c; cc <= c1; cc++) if (!empty[rr]![cc]) return false;
        return true;
      };
      while (r1 + 1 < rows && rowFree(r1 + 1)) r1++;
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) empty[rr]![cc] = false;
      const rect = { x: xs[c]!, y: ys[r]!, w: xs[c1 + 1]! - xs[c]!, h: ys[r1 + 1]! - ys[r]! };
      if (rect.w * rect.h > 1e-4) out.push(rect);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clean numbers
// ---------------------------------------------------------------------------

/** Edges this close together are one edge that drifted, not two. */
const CLUSTER = 0.0015;

function simpleFraction(value: number): number | null {
  for (let d = 1; d <= 12; d++) {
    const k = Math.round(value * d);
    if (Math.abs(value - k / d) < 1e-4) return k / d;
  }
  return null;
}

function clusterAxis(values: readonly number[]): (v: number) => number {
  const sorted = values.toSorted((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && v - last[last.length - 1]! <= CLUSTER) last.push(v);
    else groups.push([v]);
  }
  const reps = groups.map((g) => {
    for (const v of g) {
      const f = simpleFraction(v);
      if (f !== null) return { lo: g[0]!, hi: g[g.length - 1]!, rep: f };
    }
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    return { lo: g[0]!, hi: g[g.length - 1]!, rep: roundTo(mean, 0.001) };
  });
  return (v: number) => {
    const hit = reps.find((r) => v >= r.lo - EPS && v <= r.hi + EPS);
    return clamp(hit ? hit.rep : v, 0, 1);
  };
}

/**
 * Slots with their edges tidied: values that differ by float noise become one edge, simple
 * fractions become exact, the rest land on a thousandth. The grid derives its tracks from the
 * slots' edges, so two edges 0.0003 apart would otherwise become two tracks.
 */
export function normalizeSlots(slots: readonly Rect[]): Rect[] {
  const fx = clusterAxis(slots.flatMap((s) => [s.x, s.x + s.w, 0, 1]));
  const fy = clusterAxis(slots.flatMap((s) => [s.y, s.y + s.h, 0, 1]));
  const out: Rect[] = [];
  for (const s of slots) {
    const x0 = fx(s.x);
    const x1 = fx(s.x + s.w);
    const y0 = fy(s.y);
    const y1 = fy(s.y + s.h);
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (rect.w < 0.005 || rect.h < 0.005) continue;
    out.push(rect);
  }
  return out;
}

/** Short human description of a slot's size, e.g. "50 × 100%". */
const percentText = (v: number) => {
  const p = v * 100;
  return Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1);
};

export function sizeLabel(rect: Rect): string {
  return `${percentText(rect.w)} × ${percentText(rect.h)}%`;
}

/** Slots `from` onwards were just added: new tiles go before the existing PiPs, new PiPs last. */
export function placeAppended(list: readonly Rect[], from: number): Rect[] {
  const flags = overlayFlags(list);
  const existing = list.slice(0, from);
  const firstPip = existing.findIndex((_, i) => flags[i]);
  const at = firstPip < 0 ? existing.length : firstPip;
  const added = list.slice(from).map((rect, k) => ({ rect, pip: flags[from + k] }));
  return [
    ...existing.slice(0, at),
    ...added.filter((a) => !a.pip).map((a) => a.rect),
    ...existing.slice(at),
    ...added.filter((a) => a.pip).map((a) => a.rect),
  ];
}

/** The slot in `slots` closest to `rect`, to keep a selection across an edit. */
export function nearestIndex(slots: readonly Rect[], rect: Rect): number {
  let best = -1;
  let bestD = Infinity;
  slots.forEach((s, i) => {
    const d =
      Math.abs(s.x - rect.x) +
      Math.abs(s.y - rect.y) +
      Math.abs(s.w - rect.w) +
      Math.abs(s.h - rect.h);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}
