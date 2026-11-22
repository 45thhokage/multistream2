<script setup lang="ts">
/**
 * The layout editor: a free-form canvas shaped like the real grid.
 *
 * Adapted from Multi Worldview's LayoutEditor (MIT). A layout is a set of rectangles, so the
 * editor lets you handle rectangles directly: drag one to move it, pull its handles to size it (a
 * tile's neighbours follow a shared edge, like a splitter), split it into columns or rows, and drop
 * a picture-in-picture into a tile. PiPs belong to the tile they float on and ride along when it
 * moves. Everything snaps to the frame and to the other slots' edges, with guides showing what it
 * snapped to. The geometry lives in config/layoutEditorModel.ts.
 */
import { computed, nextTick, ref, watch } from "vue";
import { useEventListener, useResizeObserver } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import {
  Columns2,
  Copy,
  Grid3x3,
  Magnet,
  Minus,
  PictureInPicture2,
  Plus,
  Redo2,
  Rows2,
  SquareDashed,
  SquarePen,
  Star,
  Trash2,
  Undo2,
  X,
} from "@lucide/vue";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import LayoutPreview from "@/components/main/LayoutPreview.vue";
import {
  LAYOUTS,
  compileLayout,
  gridDimensionsFromContainer,
  type LayoutSlot,
} from "@/config/layouts";
import {
  ANCHORS,
  FINE_STEP,
  HANDLES,
  MIN_SLOT,
  anchorOf,
  carryWithHost,
  childrenOf,
  followNeighbours,
  gridRects,
  hostIndex,
  keepFloating,
  nearestIndex,
  neighbourLimits,
  neighbourTiles,
  neighboursOf,
  nextPipRect,
  normalizeSlots,
  orderSlotsBaseFirst,
  overlayFlags,
  pipInHost,
  pipInset,
  pipStrip,
  placeAppended,
  resizePipInPlace,
  resizeRect,
  sizeLabel,
  snapLines,
  snapMove,
  splitTile,
  uncoveredRects,
  type Anchor,
  type EdgeLimits,
  type Guide,
  type Handle,
  type Neighbours,
  type SnapLines,
} from "@/config/layoutEditorModel";
import { useCustomLayouts } from "@/composables/useCustomLayouts";
import { useLayoutEditor } from "@/composables/useLayoutEditor";
import { usePreferences } from "@/composables/usePreferences";
import { toast } from "@/composables/useToast";

type Rect = LayoutSlot;

/** The PiP width a new one gets, as a share of its host's width. */
const DEFAULT_PIP_SIZE = 0.25;
/** Margin of a PiP from its host's edge, as a share of the frame's width. */
const PIP_INSET = 0.015;
/** Snap reach, in screen pixels. */
const SNAP_PX = 7;
/** Pointer travel before a press becomes a drag, so a click only selects. */
const DRAG_START_PX = 3;
const SLOT_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#84cc16",
];
const TEMPLATE_IDS = [
  "solo",
  "duo",
  "quad",
  "grid-3x3",
  "focus",
  "sidebar",
  "mosaic-6",
  "theater",
  "pip",
  "pip-2-wide",
  "pip-4",
  "pip-strip-3",
];

type Drag =
  | {
      kind: "move";
      index: number;
      origin: Rect;
      start: { x: number; y: number; px: number; py: number };
      children: number[];
      lines: SnapLines;
      active: boolean;
    }
  | {
      kind: "resize";
      index: number;
      handle: Handle;
      origin: Rect;
      start: { x: number; y: number; px: number; py: number };
      neighbours: Neighbours;
      limits: EdgeLimits;
      carried: Map<number, number>;
      overlay: boolean;
      lines: SnapLines;
      active: boolean;
    }
  | {
      kind: "draw";
      start: { x: number; y: number; px: number; py: number };
      lines: SnapLines;
      active: boolean;
    };

interface Preview {
  slots: Rect[];
  guides: Guide[];
  draw?: Rect;
}

const { t } = useI18n();
const { request, closeLayoutEditor } = useLayoutEditor();
const { saveCustomLayout, updateCustomLayout } = useCustomLayouts();
const { streamLayout } = usePreferences();

const open = computed(() => request.value !== null);
const editId = computed(() => request.value?.editId);

const slots = ref<Rect[]>([]);
const past = ref<Rect[][]>([]);
const future = ref<Rect[][]>([]);
const initial = ref({ name: "", slots: "[]" });
const selected = ref<number | null>(null);
const name = ref("");
const snap = ref(true);
const drawMode = ref(false);
const floatLimit = ref(false);
const preview = ref<Preview | null>(null);
const confirmClose = ref(false);
const frameAspect = ref(16 / 9);
const canvasSize = ref({ w: 800, h: 450 });
const gridDims = ref({ cols: 2, rows: 2 });
const stageRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLElement | null>(null);
let drag: Drag | null = null;
let coalesceKey: string | null = null;

const templates = computed(() =>
  TEMPLATE_IDS.map((id) => LAYOUTS.find((layout) => layout.id === id)).filter(
    (layout): layout is (typeof LAYOUTS)[number] => !!layout
  )
);

/** The shape of the grid the layout will be drawn in, so the canvas matches it. */
function measureFrameAspect(): number {
  const grid = document.querySelector('[data-testid^="workspace-grid-"]:not([aria-hidden="true"])');
  const box = grid?.getBoundingClientRect();
  if (!box || box.width < 50 || box.height < 50) return 16 / 9;
  return Math.max(1, Math.min(3, box.width / box.height));
}

watch(
  request,
  (next) => {
    if (!next) return;
    const loaded = orderSlotsBaseFirst(normalizeSlots(next.slots));
    slots.value = loaded;
    name.value = next.name;
    initial.value = { name: next.name, slots: JSON.stringify(loaded) };
    past.value = [];
    future.value = [];
    selected.value = null;
    preview.value = null;
    confirmClose.value = false;
    drawMode.value = false;
    coalesceKey = null;
    frameAspect.value = measureFrameAspect();
    void nextTick(fitCanvas);
  },
  { immediate: true }
);

function fitCanvas() {
  const stage = stageRef.value;
  if (!stage) return;
  const box = stage.getBoundingClientRect();
  const availW = Math.max(200, box.width - 24);
  const availH = Math.max(120, box.height - 24);
  const w = Math.min(availW, availH * frameAspect.value);
  canvasSize.value = { w, h: w / frameAspect.value };
}
useResizeObserver(stageRef, fitCanvas);

const shown = computed(() => preview.value?.slots ?? slots.value);
const overlays = computed(() => overlayFlags(shown.value));
const gaps = computed(() => uncoveredRects(shown.value));
const dirty = computed(
  () => name.value !== initial.value.name || JSON.stringify(slots.value) !== initial.value.slots
);
const pipOpts = computed(() => ({
  size: DEFAULT_PIP_SIZE,
  frameAspect: frameAspect.value,
  inset: PIP_INSET,
}));
const inset = computed(() => pipInset(PIP_INSET, frameAspect.value));
const sel = computed(() =>
  selected.value !== null && slots.value[selected.value] ? selected.value : null
);
const selRect = computed(() => (sel.value !== null ? shown.value[sel.value] : null));
const selOverlay = computed(() => sel.value !== null && !!overlays.value[sel.value]);
const selHost = computed(() =>
  sel.value !== null && selOverlay.value ? hostIndex(slots.value, sel.value) : -1
);
const baseCount = computed(() => shown.value.filter((_, i) => !overlays.value[i]).length);
const pipCount = computed(() => shown.value.length - baseCount.value);
const gapShare = computed(() =>
  Math.round(gaps.value.reduce((sum, r) => sum + r.w * r.h, 0) * 100)
);
const selAnchor = computed<Anchor | null>(() => {
  if (sel.value === null || selHost.value < 0) return null;
  return anchorOf(slots.value[sel.value]!, slots.value[selHost.value]!);
});
const selPipSize = computed(() => {
  if (sel.value === null || selHost.value < 0) return 25;
  return Math.round((slots.value[sel.value]!.w / slots.value[selHost.value]!.w) * 100);
});

const pct = (v: number) => `${v * 100}%`;
const slotColor = (i: number) => SLOT_COLORS[i % SLOT_COLORS.length]!;
const roleOf = (i: number) =>
  overlays.value[i]
    ? t("layouts.editor.pip")
    : i === 0
      ? t("layouts.editor.main")
      : t("layouts.editor.tile");

// ---- edits -------------------------------------------------------------------------------------

/**
 * Every edit goes through here: tidied and undoable. The array order is the fill order (slot 1
 * gets the first stream), so an edit never reshuffles the slots that were already there.
 */
function commit(
  next: Rect[],
  focus?: Rect | null,
  opts: { order?: "keep" | "appended" | "all"; coalesce?: string } = {}
) {
  const { order = "keep", coalesce } = opts;
  const arranged =
    order === "all"
      ? orderSlotsBaseFirst(next)
      : order === "appended"
        ? placeAppended(next, slots.value.length)
        : next;
  const ordered = normalizeSlots(arranged);
  const keep = focus === undefined ? (sel.value !== null ? slots.value[sel.value]! : null) : focus;
  selected.value = keep ? nearestIndex(ordered, keep) : null;
  if (JSON.stringify(ordered) === JSON.stringify(slots.value)) return;
  const merge = coalesce !== undefined && coalesceKey === coalesce;
  coalesceKey = coalesce ?? null;
  if (!merge) past.value = [...past.value.slice(-79), slots.value];
  future.value = [];
  slots.value = ordered;
}

function undo() {
  const previous = past.value[past.value.length - 1];
  if (!previous) return;
  coalesceKey = null;
  future.value = [slots.value, ...future.value];
  slots.value = previous;
  past.value = past.value.slice(0, -1);
  selected.value = null;
}

function redo() {
  const next = future.value[0];
  if (!next) return;
  coalesceKey = null;
  past.value = [...past.value, slots.value];
  slots.value = next;
  future.value = future.value.slice(1);
  selected.value = null;
}

function largestBase(list: readonly Rect[]): number {
  const flags = overlayFlags(list);
  let best = -1;
  list.forEach((s, i) => {
    if (!flags[i] && (best < 0 || s.w * s.h > list[best]!.w * list[best]!.h)) best = i;
  });
  return best;
}

/** The tile a PiP action is about: the selected tile, the selected PiP's host, or the biggest. */
function pipHostFor(index: number | null): number {
  if (index !== null && slots.value[index]) {
    if (!overlayFlags(slots.value)[index]) return index;
    const host = hostIndex(slots.value, index);
    if (host >= 0) return host;
  }
  return largestBase(slots.value);
}

function addPip(index: number | null = sel.value, anchor?: Anchor) {
  let base = slots.value;
  let host = pipHostFor(index);
  if (host < 0) {
    base = [{ x: 0, y: 0, w: 1, h: 1 }];
    host = 0;
  }
  const rect = anchor
    ? pipInHost(base[host]!, anchor, pipOpts.value)
    : nextPipRect(base, host, pipOpts.value);
  commit([...base, rect], rect, { order: base === slots.value ? "appended" : "all" });
}

function addPipStrip(index: number | null, count: number) {
  let base = slots.value;
  let host = pipHostFor(index);
  if (host < 0) {
    base = [{ x: 0, y: 0, w: 1, h: 1 }];
    host = 0;
  }
  const strip = pipStrip(base[host]!, count, { ...pipOpts.value, size: 0.22 });
  commit([...base, ...strip], strip[strip.length - 1], {
    order: base === slots.value ? "appended" : "all",
  });
}

function split(index: number, axis: "cols" | "rows", n: number) {
  const { slots: next, parts } = splitTile(slots.value, index, axis, n, frameAspect.value);
  commit(next, parts[0]);
}

function remove(index: number) {
  commit(
    slots.value.filter((_, i) => i !== index),
    null
  );
}

function duplicate(index: number) {
  const s = slots.value[index];
  if (!s || !overlayFlags(slots.value)[index]) return;
  const host = hostIndex(slots.value, index);
  if (host < 0) return;
  const rect = nextPipRect(slots.value, host, {
    ...pipOpts.value,
    size: s.w / slots.value[host]!.w,
  });
  commit([...slots.value, rect], rect, { order: "appended" });
}

/** Swap with the previous/next slot of the same kind: fill order among tiles, stacking among PiPs. */
function reorder(index: number, dir: -1 | 1) {
  const flags = overlayFlags(slots.value);
  let j = index + dir;
  while (j >= 0 && j < slots.value.length && flags[j] !== flags[index]) j += dir;
  if (j < 0 || j >= slots.value.length) return;
  const next = [...slots.value];
  [next[index], next[j]] = [next[j]!, next[index]!];
  commit(next, slots.value[index]);
}

function makeMain(index: number) {
  if (overlayFlags(slots.value)[index] || index === 0) return;
  commit([slots.value[index]!, ...slots.value.filter((_, i) => i !== index)], slots.value[index]);
}

function placePip(index: number, anchor: Anchor) {
  const host = hostIndex(slots.value, index);
  if (host < 0) return;
  const h = slots.value[host]!;
  const rect = pipInHost(h, anchor, { ...pipOpts.value, size: slots.value[index]!.w / h.w });
  commit(
    slots.value.map((s, i) => (i === index ? rect : s)),
    rect
  );
}

function sizePip(index: number, widthShare: number) {
  const host = hostIndex(slots.value, index);
  if (host < 0) return;
  const hostRect = slots.value[host]!;
  const rect = keepFloating(
    slots.value,
    index,
    resizePipInPlace(slots.value[index]!, hostRect, widthShare * hostRect.w, frameAspect.value),
    slots.value[index]!
  ).rect;
  commit(
    slots.value.map((s, i) => (i === index ? rect : s)),
    rect,
    { coalesce: `pip-size-${index}` }
  );
}

function setRect(index: number, patch: Partial<Rect>) {
  const s = { ...slots.value[index]!, ...patch };
  s.w = Math.max(MIN_SLOT, Math.min(1, s.w));
  s.h = Math.max(MIN_SLOT, Math.min(1, s.h));
  s.x = Math.max(0, Math.min(1 - s.w, s.x));
  s.y = Math.max(0, Math.min(1 - s.h, s.y));
  const next = overlayFlags(slots.value)[index]
    ? keepFloating(slots.value, index, s, slots.value[index]!).rect
    : s;
  commit(
    slots.value.map((r, i) => (i === index ? next : r)),
    next
  );
}

function setField(key: keyof Rect, event: Event) {
  if (sel.value === null) return;
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  setRect(sel.value, { [key]: value / 100 });
}

function nudge(index: number, dx: number, dy: number) {
  const s = slots.value[index]!;
  const moved = {
    ...s,
    x: Math.max(0, Math.min(1 - s.w, s.x + dx)),
    y: Math.max(0, Math.min(1 - s.h, s.y + dy)),
  };
  const floating = overlayFlags(slots.value)[index];
  const kids = floating ? [] : childrenOf(slots.value, index);
  const to = floating ? keepFloating(slots.value, index, moved, s).rect : moved;
  commit(
    slots.value.map((r, i) => (i === index ? to : kids.includes(i) ? carryWithHost(r, s, to) : r)),
    to
  );
}

function fillGaps() {
  if (gaps.value.length > 0)
    commit([...slots.value, ...gaps.value], gaps.value[0], { order: "appended" });
}
const applyTemplate = (layout: { slots: Rect[] }) => commit(layout.slots, null, { order: "all" });
const makeGrid = () =>
  commit(gridRects(gridDims.value.cols, gridDims.value.rows), null, { order: "all" });
const stepGrid = (axis: "cols" | "rows", delta: number) => {
  gridDims.value = {
    ...gridDims.value,
    [axis]: Math.max(1, Math.min(6, gridDims.value[axis] + delta)),
  };
};

// ---- closing and saving ------------------------------------------------------------------------

function close() {
  confirmClose.value = false;
  closeLayoutEditor();
}
const requestClose = () => (dirty.value ? (confirmClose.value = true) : close());

const savedName = () => name.value.trim() || t("layouts.editor.defaultName");

function saveAsNew() {
  if (slots.value.length === 0) return;
  const dims = gridDimensionsFromContainer(compileLayout(slots.value).container);
  const saved = saveCustomLayout(savedName(), dims.cols, dims.rows, slots.value);
  streamLayout.value = saved.id;
  toast.success(t("layouts.editor.saved", { name: saved.name }));
  close();
}

function saveChanges() {
  const id = editId.value;
  if (!id || slots.value.length === 0) return;
  if (!updateCustomLayout(id, savedName(), slots.value)) {
    saveAsNew();
    return;
  }
  streamLayout.value = id;
  toast.success(t("layouts.editor.saved", { name: savedName() }));
  close();
}

// ---- keyboard ----------------------------------------------------------------------------------

useEventListener(window, "keydown", (e: KeyboardEvent) => {
  if (!open.value) return;
  const target = e.target as HTMLElement | null;
  const typing =
    !!target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === "z" && !typing) {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && key === "y" && !typing) {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    if (confirmClose.value) confirmClose.value = false;
    else if (typing) target?.blur();
    else if (drawMode.value) drawMode.value = false;
    else if (selected.value !== null) selected.value = null;
    else requestClose();
    return;
  }
  if (typing || confirmClose.value) return;
  if (mod && key === "d" && sel.value !== null) {
    e.preventDefault();
    duplicate(sel.value);
    return;
  }
  if (mod) return;
  if ((e.key === "Delete" || e.key === "Backspace") && sel.value !== null) {
    e.preventDefault();
    remove(sel.value);
  } else if (key === "p") {
    e.preventDefault();
    addPip();
  } else if (key === "d" || key === "r") {
    drawMode.value = !drawMode.value;
  } else if (key === "s" && !e.shiftKey) {
    snap.value = !snap.value;
  } else if (e.key.startsWith("Arrow") && sel.value !== null) {
    e.preventDefault();
    const step = e.shiftKey ? 0.05 : FINE_STEP * 2;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    nudge(sel.value, dx, dy);
  }
});

// ---- pointer -----------------------------------------------------------------------------------

function framePoint(clientX: number, clientY: number) {
  const box = canvasRef.value?.getBoundingClientRect();
  if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return {
    x: Math.max(0, Math.min(1, (clientX - box.left) / box.width)),
    y: Math.max(0, Math.min(1, (clientY - box.top) / box.height)),
  };
}
const threshold = () => ({ x: SNAP_PX / canvasSize.value.w, y: SNAP_PX / canvasSize.value.h });

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const el = e.target as HTMLElement;
  const active = document.activeElement as HTMLElement | null;
  if (active?.tagName === "INPUT") active.blur();
  const p = framePoint(e.clientX, e.clientY);
  const start = { ...p, px: e.clientX, py: e.clientY };
  const handle = el.closest("[data-handle]")?.getAttribute("data-handle") as Handle | null;
  const slotAttr = el.closest("[data-slot]")?.getAttribute("data-slot");
  const index = slotAttr == null ? -1 : Number(slotAttr);
  canvasRef.value?.setPointerCapture?.(e.pointerId);
  const list = slots.value;
  const flags = overlayFlags(list);
  if (handle && sel.value !== null) {
    const i = sel.value;
    const n = neighboursOf(list, i, handle.length === 2);
    const carried = new Map<number, number>();
    if (!flags[i]) {
      for (const host of [i, ...neighbourTiles(n)])
        for (const kid of childrenOf(list, host)) carried.set(kid, host);
    }
    drag = {
      kind: "resize",
      index: i,
      handle,
      origin: list[i]!,
      start,
      neighbours: n,
      limits: neighbourLimits(list, n),
      carried,
      overlay: !!flags[i],
      lines: snapLines(list, new Set([i, ...carried.keys()]), flags[i] ? inset.value : undefined),
      active: false,
    };
    return;
  }
  if (index >= 0 && !drawMode.value && !e.ctrlKey) {
    selected.value = index;
    const kids = flags[index] ? [] : childrenOf(list, index);
    drag = {
      kind: "move",
      index,
      origin: list[index]!,
      start,
      children: kids,
      lines: snapLines(list, new Set([index, ...kids]), flags[index] ? inset.value : undefined),
      active: false,
    };
    return;
  }
  selected.value = null;
  drag = { kind: "draw", start, lines: snapLines(list, new Set(), inset.value), active: false };
}

function onPointerMove(e: PointerEvent) {
  const current = drag;
  if (!current) return;
  if (e.pointerType === "mouse" && e.buttons === 0) {
    onPointerUp();
    return;
  }
  if (!current.active) {
    if (Math.hypot(e.clientX - current.start.px, e.clientY - current.start.py) < DRAG_START_PX)
      return;
    current.active = true;
  }
  const list = slots.value;
  const p = framePoint(e.clientX, e.clientY);
  const dx = p.x - current.start.x;
  const dy = p.y - current.start.y;
  const opts = { lines: current.lines, threshold: threshold(), enabled: snap.value && !e.altKey };
  if (current.kind === "move") {
    const snapped = snapMove(
      { ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy },
      opts,
      current.origin
    );
    const held = overlayFlags(list)[current.index]
      ? keepFloating(list, current.index, snapped.rect, current.origin)
      : { rect: snapped.rect, limited: false };
    floatLimit.value = held.limited;
    const rect = held.rect;
    preview.value = {
      slots: list.map((s, i) =>
        i === current.index
          ? rect
          : current.children.includes(i)
            ? carryWithHost(s, current.origin, rect)
            : s
      ),
      guides: held.limited ? [] : snapped.guides,
    };
  } else if (current.kind === "resize") {
    const corner = current.handle.length === 2;
    // A PiP keeps its picture's shape unless Shift frees it; a tile is free unless Shift locks it.
    const keep = corner && current.overlay !== e.shiftKey;
    const { rect: sized, guides } = resizeRect(current.origin, current.handle, dx, dy, {
      ...opts,
      aspect: keep ? current.origin.w / current.origin.h : undefined,
      // Alt resizes a tile on its own, over its neighbours.
      limits: e.altKey || current.overlay ? undefined : current.limits,
    });
    const held = current.overlay
      ? keepFloating(list, current.index, sized, current.origin)
      : { rect: sized, limited: false };
    floatLimit.value = held.limited;
    const rect = held.rect;
    const follow =
      e.altKey || current.overlay
        ? new Map<number, Rect>()
        : followNeighbours(list, current.neighbours, current.origin, rect);
    const after = (i: number) => (i === current.index ? rect : (follow.get(i) ?? list[i]!));
    preview.value = {
      slots: list.map((s, i) => {
        if (i === current.index || follow.has(i)) return after(i);
        const host = current.carried.get(i);
        if (host !== undefined && after(host) !== list[host])
          return carryWithHost(s, list[host]!, after(host));
        return s;
      }),
      guides,
    };
  } else {
    const a = snapMove({ x: current.start.x, y: current.start.y, w: 0, h: 0 }, opts);
    const b = snapMove({ x: p.x, y: p.y, w: 0, h: 0 }, opts);
    preview.value = {
      slots: list,
      guides: [...a.guides, ...b.guides],
      draw: {
        x: Math.min(a.rect.x, b.rect.x),
        y: Math.min(a.rect.y, b.rect.y),
        w: Math.abs(b.rect.x - a.rect.x),
        h: Math.abs(b.rect.y - a.rect.y),
      },
    };
  }
}

function onPointerUp() {
  const current = drag;
  drag = null;
  const result = preview.value;
  preview.value = null;
  floatLimit.value = false;
  if (!current || !current.active || !result) return;
  if (current.kind === "draw") {
    const d = result.draw;
    if (d && d.w >= MIN_SLOT && d.h >= MIN_SLOT)
      commit([...slots.value, d], d, { order: "appended" });
    drawMode.value = false;
    return;
  }
  commit(result.slots, result.slots[current.index]);
}

function onPointerCancel() {
  drag = null;
  preview.value = null;
  floatLimit.value = false;
}

function onDoubleClick(e: MouseEvent) {
  // The press before this captured the pointer on the canvas, so the event target is always the
  // canvas: look up what is really under the pointer.
  const el = (document.elementFromPoint?.(e.clientX, e.clientY) as HTMLElement | null) ?? null;
  if (!el || !canvasRef.value?.contains(el) || el.closest("[data-handle]")) return;
  const gap = el.closest("[data-gap]")?.getAttribute("data-gap");
  if (gap != null) {
    const rect = gaps.value[Number(gap)];
    if (rect) commit([...slots.value, rect], rect, { order: "appended" });
    return;
  }
  const slotAttr = el.closest("[data-slot]")?.getAttribute("data-slot");
  if (slotAttr == null) return;
  const i = Number(slotAttr);
  if (overlayFlags(slots.value)[i]) return;
  // Drop a PiP in the corner nearest to where the tile was double-clicked.
  const p = framePoint(e.clientX, e.clientY);
  const corner = anchorOf({ x: p.x, y: p.y, w: 0, h: 0 }, slots.value[i]!);
  addPip(i, corner[0] === "m" || corner[1] === "c" ? undefined : corner);
}

const handleStyle = (h: Handle): Record<string, string> => {
  const style: Record<string, string> = {};
  style.left = h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%";
  style.top = h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%";
  const cursor: Record<Handle, string> = {
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize",
  };
  style.cursor = cursor[h];
  return style;
};

const fieldValue = (v: number) => Math.round(v * 1000) / 10;
const btn =
  "inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-md border border-[#2a2d33] bg-[#1f2227] text-xs text-gray-200 hover:bg-[#2a2d33] hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const tool =
  "inline-flex items-center justify-center size-8 rounded-md text-gray-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && requestClose()">
    <DialogContent
      data-testid="layout-editor"
      :show-close-button="false"
      class="bg-[#14161a] border-[#2a2d33] p-0 gap-0 sm:max-w-none md:max-w-none w-[min(1180px,calc(100vw-2rem))] h-[min(780px,calc(100vh-2rem))] flex flex-col overflow-hidden"
      @escape-key-down.prevent
      @interact-outside.prevent
      @open-auto-focus.prevent
    >
      <!-- header -->
      <div class="flex items-center gap-2 h-12 shrink-0 px-3 border-b border-[#2a2d33]">
        <SquarePen class="size-4 text-gray-400 shrink-0" aria-hidden="true" />
        <DialogTitle class="text-sm font-semibold text-white shrink-0">{{
          t("layouts.editor.title")
        }}</DialogTitle>
        <input
          v-model="name"
          data-testid="layout-editor-name"
          type="text"
          maxlength="40"
          spellcheck="false"
          :aria-label="t('layouts.editor.name')"
          :placeholder="t('layouts.editor.defaultName')"
          class="ml-2 h-8 w-64 min-w-0 px-2.5 rounded-md bg-[#1f2227] border border-[#2a2d33] text-xs text-[#eaeaea] placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
        <div class="flex-1" />
        <button
          type="button"
          :class="tool"
          :disabled="past.length === 0"
          :aria-label="t('layouts.editor.undo')"
          :title="t('layouts.editor.undo')"
          @click="undo"
        >
          <Undo2 class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="tool"
          :disabled="future.length === 0"
          :aria-label="t('layouts.editor.redo')"
          :title="t('layouts.editor.redo')"
          @click="redo"
        >
          <Redo2 class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="layout-editor-draw"
          :class="[tool, drawMode ? '!bg-indigo-500/20 !text-indigo-300' : '']"
          :aria-pressed="drawMode"
          :aria-label="t('layouts.editor.draw')"
          :title="t('layouts.editor.draw')"
          @click="drawMode = !drawMode"
        >
          <SquareDashed class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="[tool, snap ? '!text-indigo-300' : '']"
          :aria-pressed="snap"
          :aria-label="t('layouts.editor.snap')"
          :title="t('layouts.editor.snap')"
          @click="snap = !snap"
        >
          <Magnet class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="layout-editor-close"
          :class="tool"
          :aria-label="t('layouts.editor.close')"
          :title="t('layouts.editor.close')"
          @click="requestClose"
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </div>

      <div class="flex flex-1 min-h-0">
        <!-- left rail: starting points -->
        <aside
          class="w-44 shrink-0 border-r border-[#2a2d33] overflow-y-auto custom-scrollbar p-3 space-y-3"
        >
          <div class="space-y-1.5">
            <h3 class="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
              {{ t("layouts.editor.grid") }}
            </h3>
            <div class="flex items-center gap-1 text-xs text-gray-200">
              <button
                type="button"
                :class="tool"
                class="!size-6"
                :aria-label="t('layouts.editor.fewer', { what: t('layouts.editor.columns') })"
                :title="t('layouts.editor.fewer', { what: t('layouts.editor.columns') })"
                @click="stepGrid('cols', -1)"
              >
                <Minus class="size-3" aria-hidden="true" />
              </button>
              <span class="tabular-nums w-3 text-center">{{ gridDims.cols }}</span>
              <button
                type="button"
                :class="tool"
                class="!size-6"
                :aria-label="t('layouts.editor.more', { what: t('layouts.editor.columns') })"
                :title="t('layouts.editor.more', { what: t('layouts.editor.columns') })"
                @click="stepGrid('cols', 1)"
              >
                <Plus class="size-3" aria-hidden="true" />
              </button>
              <span class="text-gray-500">×</span>
              <button
                type="button"
                :class="tool"
                class="!size-6"
                :aria-label="t('layouts.editor.fewer', { what: t('layouts.editor.rows') })"
                :title="t('layouts.editor.fewer', { what: t('layouts.editor.rows') })"
                @click="stepGrid('rows', -1)"
              >
                <Minus class="size-3" aria-hidden="true" />
              </button>
              <span class="tabular-nums w-3 text-center">{{ gridDims.rows }}</span>
              <button
                type="button"
                :class="tool"
                class="!size-6"
                :aria-label="t('layouts.editor.more', { what: t('layouts.editor.rows') })"
                :title="t('layouts.editor.more', { what: t('layouts.editor.rows') })"
                @click="stepGrid('rows', 1)"
              >
                <Plus class="size-3" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              :class="btn"
              class="w-full"
              :title="t('layouts.editor.applyGrid', gridDims)"
              @click="makeGrid"
            >
              <Grid3x3 class="size-3.5" aria-hidden="true" />{{ t("layouts.gridSize", gridDims) }}
            </button>
          </div>
          <div class="space-y-1.5">
            <h3 class="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
              {{ t("layouts.editor.startFrom") }}
            </h3>
            <div class="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                class="flex flex-col gap-1 rounded-md border border-transparent p-1 hover:bg-[#1e2127] cursor-pointer text-left"
                :title="t('layouts.editor.blank')"
                @click="commit([], null)"
              >
                <span
                  class="block w-full aspect-video rounded-sm border border-dashed border-[#3a3f4b] bg-[#0f1115]"
                  aria-hidden="true"
                />
                <span class="text-[10px] text-gray-400 truncate">{{
                  t("layouts.editor.blank")
                }}</span>
              </button>
              <button
                v-for="layout in templates"
                :key="layout.id"
                type="button"
                class="flex flex-col gap-1 rounded-md border border-transparent p-1 hover:bg-[#1e2127] cursor-pointer text-left min-w-0"
                :title="t(layout.labelKey, layout.labelParams ?? {})"
                @click="applyTemplate(layout)"
              >
                <LayoutPreview :slots="layout.slots" />
                <span class="text-[10px] text-gray-400 truncate">{{
                  t(layout.labelKey, layout.labelParams ?? {})
                }}</span>
              </button>
            </div>
          </div>
        </aside>

        <!-- stage -->
        <div
          ref="stageRef"
          class="relative flex-1 min-w-0 flex items-center justify-center bg-[#0f1115]"
        >
          <div
            ref="canvasRef"
            data-testid="layout-editor-canvas"
            class="relative select-none touch-none bg-[#191b1f] outline outline-1 outline-[#2a2d33]"
            :class="drawMode ? 'cursor-crosshair' : ''"
            :style="{ width: `${canvasSize.w}px`, height: `${canvasSize.h}px` }"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerCancel"
            @lostpointercapture="onPointerUp"
            @dblclick="onDoubleClick"
          >
            <!-- empty areas -->
            <div
              v-for="(gap, gi) in gaps"
              :key="`gap-${gi}`"
              :data-gap="gi"
              class="absolute box-border border border-dashed border-white/15 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(255,255,255,0.03)_6px,rgba(255,255,255,0.03)_12px)]"
              :title="t('layouts.editor.gapHint')"
              :style="{ left: pct(gap.x), top: pct(gap.y), width: pct(gap.w), height: pct(gap.h) }"
            />

            <!-- slots -->
            <div
              v-for="(slot, i) in shown"
              :key="`slot-${i}`"
              :data-slot="i"
              :data-testid="`layout-editor-slot-${i}`"
              class="absolute box-border rounded-[3px] flex items-center justify-center overflow-hidden"
              :class="drawMode ? 'cursor-crosshair' : 'cursor-move'"
              :style="{
                left: pct(slot.x),
                top: pct(slot.y),
                width: pct(slot.w),
                height: pct(slot.h),
                zIndex: overlays[i] ? 10 + i : 1,
                background: `${slotColor(i)}${overlays[i] ? '55' : '33'}`,
                border: `${sel === i ? 2 : 1}px solid ${sel === i ? '#fff' : slotColor(i)}`,
                boxShadow: overlays[i] ? '0 4px 14px rgba(0,0,0,0.5)' : 'none',
              }"
            >
              <span class="pointer-events-none text-center leading-tight px-1">
                <span class="block text-sm font-semibold text-white tabular-nums">{{ i + 1 }}</span>
                <span
                  v-if="slot.w * canvasSize.w > 70 && slot.h * canvasSize.h > 44"
                  class="block text-[10px] text-white/70"
                  >{{ roleOf(i) }} · {{ sizeLabel(slot) }}</span
                >
              </span>
            </div>

            <!-- selection handles -->
            <div
              v-if="selRect && !drawMode"
              class="absolute pointer-events-none"
              :style="{
                left: pct(selRect.x),
                top: pct(selRect.y),
                width: pct(selRect.w),
                height: pct(selRect.h),
                zIndex: 200,
              }"
            >
              <span
                v-for="h in HANDLES"
                :key="h"
                :data-handle="h"
                class="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-white border border-[#14161a] pointer-events-auto"
                :style="handleStyle(h)"
              />
            </div>

            <!-- drawing preview -->
            <div
              v-if="preview?.draw"
              class="absolute border-2 border-dashed border-indigo-400 bg-indigo-400/15 pointer-events-none"
              :style="{
                left: pct(preview.draw.x),
                top: pct(preview.draw.y),
                width: pct(preview.draw.w),
                height: pct(preview.draw.h),
                zIndex: 210,
              }"
            />

            <!-- guides -->
            <span
              v-for="(g, gi) in preview?.guides ?? []"
              :key="`guide-${gi}`"
              class="absolute bg-pink-400 pointer-events-none"
              :style="
                g.axis === 'x'
                  ? { left: pct(g.at), top: '0', bottom: '0', width: '1px', zIndex: 220 }
                  : { top: pct(g.at), left: '0', right: '0', height: '1px', zIndex: 220 }
              "
            />

            <!-- empty canvas -->
            <div
              v-if="slots.length === 0 && !preview?.draw"
              class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-gray-400 pointer-events-none"
            >
              <p>{{ t("layouts.editor.emptyCanvas") }}</p>
              <div class="flex gap-2 pointer-events-auto">
                <button
                  type="button"
                  :class="btn"
                  @pointerdown.stop
                  @click="commit([{ x: 0, y: 0, w: 1, h: 1 }], null)"
                >
                  {{ t("layouts.editor.fullTile") }}
                </button>
                <button type="button" :class="btn" @pointerdown.stop @click="addPip()">
                  <PictureInPicture2 class="size-3.5" aria-hidden="true" />{{
                    t("layouts.editor.addPip")
                  }}
                </button>
              </div>
            </div>
          </div>
          <p
            v-if="floatLimit"
            role="status"
            class="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-amber-300 bg-black/70 rounded px-2 py-0.5"
          >
            {{ t("layouts.editor.floatLimit") }}
          </p>
        </div>

        <!-- inspector -->
        <aside
          class="w-60 shrink-0 border-l border-[#2a2d33] overflow-y-auto custom-scrollbar p-3 space-y-3 text-xs text-gray-300"
        >
          <template v-if="sel === null">
            <p class="text-gray-200 font-medium">
              {{ t("layouts.editor.summary", { tiles: baseCount, pips: pipCount }) }}
            </p>
            <p v-if="gapShare > 0" class="text-amber-300/90">
              {{ t("layouts.editor.gapShare", { pct: gapShare }) }}
            </p>
            <p class="text-gray-400 leading-relaxed">{{ t("layouts.editor.noSelection") }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                type="button"
                :class="btn"
                :title="t('layouts.editor.addPipKey')"
                @click="addPip()"
              >
                <PictureInPicture2 class="size-3.5" aria-hidden="true" />{{
                  t("layouts.editor.addPip")
                }}
              </button>
              <button v-if="gaps.length" type="button" :class="btn" @click="fillGaps">
                <Plus class="size-3.5" aria-hidden="true" />{{ t("layouts.editor.fillGaps") }}
              </button>
            </div>
          </template>

          <template v-else-if="selRect">
            <div class="flex items-center justify-between">
              <span class="font-medium text-gray-100"
                >{{ t("layouts.editor.slot", { n: sel + 1 }) }} · {{ roleOf(sel) }}</span
              >
              <button
                type="button"
                :class="tool"
                class="!size-6"
                :aria-label="t('layouts.editor.deselect')"
                :title="t('layouts.editor.deselect')"
                @click="selected = null"
              >
                <X class="size-3.5" aria-hidden="true" />
              </button>
            </div>

            <fieldset class="space-y-1.5">
              <legend class="text-[11px] text-gray-400 mb-1">
                {{ t("layouts.editor.position") }}
              </legend>
              <div class="grid grid-cols-2 gap-1.5">
                <label
                  v-for="key in ['x', 'y', 'w', 'h'] as const"
                  :key="key"
                  class="flex items-center gap-1.5"
                >
                  <span class="w-3 text-gray-500 uppercase">{{ key }}</span>
                  <input
                    :key="`${sel}-${key}-${selRect[key]}`"
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    :value="fieldValue(selRect[key])"
                    class="w-full h-7 px-1.5 rounded-md bg-[#1f2227] border border-[#2a2d33] text-xs text-gray-100 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    @change="setField(key, $event)"
                  />
                </label>
              </div>
            </fieldset>

            <!-- tile actions -->
            <template v-if="!selOverlay">
              <div class="space-y-1.5">
                <p class="text-[11px] text-gray-400">{{ t("layouts.editor.split") }}</p>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="n in [2, 3]"
                    :key="`c${n}`"
                    type="button"
                    :class="btn"
                    :title="t('layouts.editor.splitCols', { n })"
                    @click="split(sel, 'cols', n)"
                  >
                    <Columns2 class="size-3.5" aria-hidden="true" />{{ n }}
                  </button>
                  <button
                    v-for="n in [2, 3]"
                    :key="`r${n}`"
                    type="button"
                    :class="btn"
                    :title="t('layouts.editor.splitRows', { n })"
                    @click="split(sel, 'rows', n)"
                  >
                    <Rows2 class="size-3.5" aria-hidden="true" />{{ n }}
                  </button>
                </div>
              </div>
              <div class="space-y-1.5">
                <p class="text-[11px] text-gray-400">{{ t("layouts.editor.pipStrip") }}</p>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    :class="btn"
                    :title="t('layouts.editor.addPipKey')"
                    @click="addPip(sel)"
                  >
                    <PictureInPicture2 class="size-3.5" aria-hidden="true" />{{
                      t("layouts.editor.addPip")
                    }}
                  </button>
                  <button
                    v-for="n in [2, 3, 4]"
                    :key="`s${n}`"
                    type="button"
                    :class="btn"
                    :title="t('layouts.editor.pipStripHint', { n })"
                    @click="addPipStrip(sel, n)"
                  >
                    ×{{ n }}
                  </button>
                </div>
              </div>
            </template>

            <!-- PiP actions -->
            <template v-else>
              <div class="space-y-1.5">
                <p class="text-[11px] text-gray-400">{{ t("layouts.editor.pipPosition") }}</p>
                <div
                  class="grid grid-cols-3 gap-1 w-24"
                  role="group"
                  :aria-label="t('layouts.editor.pipPosition')"
                >
                  <button
                    v-for="a in ANCHORS"
                    :key="a"
                    type="button"
                    class="h-5 rounded-sm border cursor-pointer transition-colors"
                    :class="
                      selAnchor === a
                        ? 'bg-indigo-500 border-indigo-400'
                        : 'bg-[#1f2227] border-[#2a2d33] hover:bg-[#2a2d33]'
                    "
                    :aria-label="t(`layouts.editor.anchors.${a}`)"
                    :title="t(`layouts.editor.anchors.${a}`)"
                    :aria-pressed="selAnchor === a"
                    @click="placePip(sel, a)"
                  />
                </div>
              </div>
              <label class="block space-y-1">
                <span class="flex justify-between text-[11px] text-gray-400"
                  ><span>{{ t("layouts.editor.pipSize") }}</span
                  ><span class="tabular-nums">{{ selPipSize }}%</span></span
                >
                <input
                  type="range"
                  min="5"
                  max="90"
                  :value="selPipSize"
                  class="w-full accent-indigo-500"
                  @input="sizePip(sel, Number(($event.target as HTMLInputElement).value) / 100)"
                />
              </label>
              <button type="button" :class="btn" @click="duplicate(sel)">
                <Copy class="size-3.5" aria-hidden="true" />{{ t("layouts.editor.duplicate") }}
              </button>
            </template>

            <div class="flex flex-wrap gap-1.5 pt-1 border-t border-[#2a2d33]">
              <button type="button" :class="btn" @click="reorder(sel, -1)">
                {{ selOverlay ? t("layouts.editor.backward") : t("layouts.editor.earlier") }}
              </button>
              <button type="button" :class="btn" @click="reorder(sel, 1)">
                {{ selOverlay ? t("layouts.editor.forward") : t("layouts.editor.later") }}
              </button>
              <button
                v-if="!selOverlay && sel !== 0"
                type="button"
                :class="btn"
                @click="makeMain(sel)"
              >
                <Star class="size-3.5" aria-hidden="true" />{{ t("layouts.editor.makeMain") }}
              </button>
              <button
                type="button"
                :class="btn"
                class="!text-red-300 hover:!bg-red-500/20"
                @click="remove(sel)"
              >
                <Trash2 class="size-3.5" aria-hidden="true" />{{ t("layouts.editor.remove") }}
              </button>
            </div>
          </template>
        </aside>
      </div>

      <!-- footer -->
      <div class="flex items-center justify-end gap-2 h-14 shrink-0 px-3 border-t border-[#2a2d33]">
        <button type="button" :class="btn" class="h-8" @click="requestClose">
          {{ t("layouts.editor.cancel") }}
        </button>
        <button
          type="button"
          data-testid="layout-editor-save-new"
          :class="btn"
          class="h-8"
          :disabled="slots.length === 0"
          @click="saveAsNew"
        >
          {{ t("layouts.editor.saveNew") }}
        </button>
        <button
          v-if="editId"
          type="button"
          data-testid="layout-editor-save"
          :class="btn"
          class="h-8 !bg-indigo-600 !border-indigo-500 hover:!bg-indigo-500 !text-white"
          :disabled="slots.length === 0"
          @click="saveChanges"
        >
          {{ t("layouts.editor.saveChanges") }}
        </button>
      </div>

      <!-- unsaved changes -->
      <div
        v-if="confirmClose"
        class="absolute inset-0 z-[300] flex items-center justify-center bg-black/60"
        role="alertdialog"
        :aria-label="t('layouts.editor.unsavedTitle')"
      >
        <div class="w-80 rounded-lg border border-[#2a2d33] bg-[#14161a] p-4 space-y-3">
          <p class="text-sm font-semibold text-white">{{ t("layouts.editor.unsavedTitle") }}</p>
          <p class="text-xs text-gray-400">{{ t("layouts.editor.unsavedBody") }}</p>
          <div class="flex justify-end gap-2">
            <button type="button" :class="btn" @click="confirmClose = false">
              {{ t("layouts.editor.keepEditing") }}
            </button>
            <button
              type="button"
              data-testid="layout-editor-discard"
              :class="btn"
              class="!text-red-300 hover:!bg-red-500/20"
              @click="close"
            >
              {{ t("layouts.editor.discard") }}
            </button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
