import type { Stream } from "@/composables/useStreams";
import { PRESET_SPECS, type LayoutGroup, type LayoutSlot } from "./layoutPresets";

export type { LayoutGroup, LayoutSlot } from "./layoutPresets";
export type LayoutId = "auto" | (typeof PRESET_SPECS)[number]["id"];
export const LAYOUT_IDS: readonly LayoutId[] = ["auto", ...PRESET_SPECS.map((spec) => spec.id)];
export const DEFAULT_LAYOUT: LayoutId = "auto";
export const FALLBACK_LAYOUT: LayoutId = "quad";

export interface LayoutDef {
  id: LayoutId;
  labelKey: string;
  labelParams?: { cols: number; rows: number };
  group: LayoutGroup;
  slots: LayoutSlot[];
  maxVisible: number;
}

export function gridSlots(cols: number, rows: number): LayoutSlot[] {
  return Array.from({ length: cols * rows }, (_, index) => ({
    x: (index % cols) / cols,
    y: Math.floor(index / cols) / rows,
    w: 1 / cols,
    h: 1 / rows,
  }));
}

export const LAYOUTS: LayoutDef[] = [
  {
    id: "auto",
    labelKey: "layouts.auto",
    group: "grid",
    slots: gridSlots(2, 2),
    maxVisible: Infinity,
  },
  ...PRESET_SPECS.map(
    (spec): LayoutDef => ({
      id: spec.id,
      labelKey: spec.labelKey,
      labelParams: "cols" in spec ? { cols: spec.cols, rows: spec.rows } : undefined,
      group: spec.group,
      slots: spec.rects.map(([x, y, w, h]) => ({ x, y, w, h })),
      maxVisible: spec.rects.length,
    })
  ),
];

export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === "string" && LAYOUT_IDS.some((id) => id === value);
}

export function resolveLayout(value: unknown): LayoutId {
  return isLayoutId(value) ? value : FALLBACK_LAYOUT;
}

export function getLayoutDef(id: LayoutId): LayoutDef {
  return (
    LAYOUTS.find((layout) => layout.id === id) ?? {
      id: FALLBACK_LAYOUT,
      labelKey: "layouts.quad",
      group: "grid",
      slots: gridSlots(2, 2),
      maxVisible: 4,
    }
  );
}

export function autoGridDims(count: number): { cols: number; rows: number } {
  const grids = [
    [1, 1],
    [2, 1],
    [3, 1],
    [2, 2],
    [3, 2],
    [4, 2],
    [3, 3],
    [5, 2],
    [4, 3],
    [4, 4],
  ];
  const fit = grids.find(([cols = 1, rows = 1]) => cols * rows >= Math.max(1, count));
  const cols = fit?.[0] ?? Math.ceil(Math.sqrt(count));
  return { cols, rows: fit?.[1] ?? Math.ceil(count / cols) };
}

export function getLayoutSlots(id: LayoutId, streamCount = 0): LayoutSlot[] {
  if (id !== "auto") return getLayoutDef(id).slots;
  const { cols, rows } = autoGridDims(streamCount);
  return gridSlots(cols, rows);
}

export function displaySlots(slots: LayoutSlot[], streamCount: number): LayoutSlot[] {
  if (slots.length === 1 || slots.length >= streamCount) return slots;
  const { cols, rows } = autoGridDims(streamCount);
  return gridSlots(cols, rows);
}

export function orderStreamsForLayout(streams: Stream[], focusedId: string | null): Stream[] {
  const focused = streams.find((stream) => stream.id === focusedId);
  return focused ? [focused, ...streams.filter((stream) => stream.id !== focusedId)] : [...streams];
}

const rounded = (value: number) => Math.round(value * 1e6) / 1e6;

function boundaries(slots: LayoutSlot[], axis: "x" | "y"): number[] {
  const size = axis === "x" ? "w" : "h";
  return [
    ...new Set([
      0,
      1,
      ...slots.flatMap((slot) => [rounded(slot[axis]), rounded(slot[axis] + slot[size])]),
    ]),
  ].toSorted((a, b) => a - b);
}

function tracks(edges: number[]): string {
  const sizes = edges.slice(1).map((edge, index) => rounded(edge - (edges[index] ?? 0)));
  if (sizes.every((size) => Math.abs(size - (sizes[0] ?? 1)) < 1e-5)) {
    return `repeat(${sizes.length}, minmax(0, 1fr))`;
  }
  return sizes.map((size) => `minmax(0, ${rounded(size * 1000)}fr)`).join(" ");
}

export function isOverlaySlot(slot: LayoutSlot, index: number, slots: LayoutSlot[]): boolean {
  return slots.some((other, otherIndex) => {
    if (index === otherIndex) return false;
    const overlaps =
      slot.x < other.x + other.w - 1e-6 &&
      other.x < slot.x + slot.w - 1e-6 &&
      slot.y < other.y + other.h - 1e-6 &&
      other.y < slot.y + slot.h - 1e-6;
    const areaDifference = other.w * other.h - slot.w * slot.h;
    return (
      overlaps && (areaDifference > 1e-6 || (Math.abs(areaDifference) < 1e-6 && otherIndex < index))
    );
  });
}

export interface SlotPlacement {
  index: number;
  style: Record<string, string>;
  overlayIndex: number;
}

export function compileLayout(slots: LayoutSlot[]): {
  container: Record<string, string>;
  placements: SlotPlacement[];
} {
  const xs = boundaries(slots, "x");
  const ys = boundaries(slots, "y");
  let overlayCount = 0;
  const placements = slots.map((slot, index) => {
    const overlayIndex = isOverlaySlot(slot, index, slots) ? overlayCount++ : -1;
    const startCol = xs.indexOf(rounded(slot.x)) + 1;
    const endCol = xs.indexOf(rounded(slot.x + slot.w)) + 1;
    const startRow = ys.indexOf(rounded(slot.y)) + 1;
    const endRow = ys.indexOf(rounded(slot.y + slot.h)) + 1;
    return {
      index,
      overlayIndex,
      style: {
        gridColumn: `${startCol} / ${endCol}`,
        gridRow: `${startRow} / ${endRow}`,
        zIndex: `${overlayIndex >= 0 ? overlayIndex + 2 : 0}`,
      },
    };
  });
  return {
    container: {
      display: "grid",
      position: "relative",
      gap: "2px",
      gridTemplateColumns: tracks(xs),
      gridTemplateRows: tracks(ys),
    },
    placements,
  };
}

export interface PlacedStream {
  id: string;
  hidden: boolean;
  style: Record<string, string>;
  spanLastOdd: boolean;
  overlayIndex: number;
}

export interface ArrangedLayout {
  container: Record<string, string>;
  placedById: Record<string, PlacedStream>;
  mainId: string | null;
  overlay: boolean;
  emptySlots: number;
  emptyPlacements: SlotPlacement[];
  expanded: boolean;
}

function arrangeSlots(
  slots: LayoutSlot[],
  streams: Stream[],
  focusedId: string | null
): ArrangedLayout {
  const shownSlots = displaySlots(slots, streams.length);
  const { container, placements } = compileLayout(shownSlots);
  const ordered = orderStreamsForLayout(streams, focusedId);
  const placedById: Record<string, PlacedStream> = {};
  ordered.forEach((stream, index) => {
    const placement = placements[index];
    placedById[stream.id] = {
      id: stream.id,
      hidden: !placement,
      style: placement?.style ?? {},
      spanLastOdd: false,
      overlayIndex: placement?.overlayIndex ?? -1,
    };
  });
  const emptyPlacements = placements.slice(ordered.length);
  return {
    container,
    placedById,
    mainId: ordered[0]?.id ?? null,
    overlay: placements.some((slot) => slot.overlayIndex >= 0),
    emptySlots: emptyPlacements.length,
    emptyPlacements,
    expanded: shownSlots !== slots,
  };
}

export function arrangeStreams(
  layout: LayoutId,
  streams: Stream[],
  focusedId: string | null
): ArrangedLayout {
  return arrangeSlots(getLayoutSlots(layout, streams.length), streams, focusedId);
}

export interface CustomLayoutDef {
  id: string;
  name: string;
  cols: number;
  rows: number;
  slots?: LayoutSlot[];
}

export function isCustomLayoutId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("custom-");
}

export function clampGridSize(value: number): number {
  return Number.isFinite(value) ? Math.min(6, Math.max(1, Math.floor(value))) : 1;
}

export function customLayoutSlots(def: CustomLayoutDef): LayoutSlot[] {
  const valid =
    def.slots?.length &&
    def.slots.every(
      (slot) =>
        [slot.x, slot.y, slot.w, slot.h].every(Number.isFinite) &&
        slot.x >= 0 &&
        slot.y >= 0 &&
        slot.w > 0 &&
        slot.h > 0 &&
        slot.x + slot.w <= 1.000001 &&
        slot.y + slot.h <= 1.000001
    );
  return valid ? (def.slots ?? []) : gridSlots(clampGridSize(def.cols), clampGridSize(def.rows));
}

function countTracks(template: string): number {
  const repeated = /repeat\(\s*(\d+)\s*,/.exec(template);
  if (repeated?.[1]) return Number(repeated[1]);
  return template.match(/minmax\([^)]*\)|[^\s]+/g)?.length ?? 1;
}

export function gridDimensionsFromContainer(container: Record<string, string>): {
  cols: number;
  rows: number;
} {
  return {
    cols: clampGridSize(countTracks(container.gridTemplateColumns ?? "")),
    rows: clampGridSize(countTracks(container.gridTemplateRows ?? "")),
  };
}

export function arrangeCustomStreams(
  def: CustomLayoutDef,
  streams: Stream[],
  focusedId: string | null
): ArrangedLayout {
  return arrangeSlots(customLayoutSlots(def), streams, focusedId);
}
