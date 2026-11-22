import { ref } from "vue";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { LayoutSlot } from "@/config/layouts";
import { isTauri } from "@/lib/http";

/** What the layout editor opens on: a starting shape, its name, and the saved layout it edits. */
export interface LayoutEditorRequest {
  slots: LayoutSlot[];
  name: string;
  /** A saved custom layout being edited in place; absent for a new layout. */
  editId?: string;
}

/** Tauri event the layout picker's overlay window sends to the main window. */
export const LAYOUT_EDITOR_EVENT = "layout-editor-open";

const request = ref<LayoutEditorRequest | null>(null);
let listening = false;

const openLayoutEditor = (next: LayoutEditorRequest): void => {
  request.value = {
    ...next,
    slots: next.slots.map((slot) => ({ ...slot })),
  };
};

const closeLayoutEditor = (): void => {
  request.value = null;
};

/**
 * Opens the editor in the main window. The layout picker can be rendered in its own native
 * overlay window (so it floats above the stream WebViews); from there the request is sent to the
 * main window, which owns the editor dialog.
 */
const requestLayoutEditor = (next: LayoutEditorRequest, fromOverlay: boolean): void => {
  if (fromOverlay && isTauri()) {
    void emitTo("main", LAYOUT_EDITOR_EVENT, next).catch(() => openLayoutEditor(next));
    return;
  }
  openLayoutEditor(next);
};

/** Main window only: accept requests from the overlay window. */
const listenForLayoutEditorRequests = (): void => {
  if (listening || !isTauri()) return;
  listening = true;
  void listen<LayoutEditorRequest>(LAYOUT_EDITOR_EVENT, (event) =>
    openLayoutEditor(event.payload)
  ).catch(() => {
    listening = false;
  });
};

export function useLayoutEditor() {
  return {
    request,
    openLayoutEditor,
    closeLayoutEditor,
    requestLayoutEditor,
    listenForLayoutEditorRequests,
  };
}
