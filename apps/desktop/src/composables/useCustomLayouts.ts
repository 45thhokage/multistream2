import { createSharedComposable, useStorage } from "@vueuse/core";
import {
  DEFAULT_LAYOUT,
  clampGridSize,
  type LayoutSlot,
  type CustomLayoutDef,
} from "@/config/layouts";
import { usePreferences } from "./usePreferences";

const _useCustomLayouts = () => {
  const customLayouts = useStorage<CustomLayoutDef[]>("custom-layouts", []);

  const saveCustomLayout = (
    name: string,
    cols: number,
    rows: number,
    slots?: LayoutSlot[]
  ): CustomLayoutDef => {
    const def: CustomLayoutDef = {
      id: `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      name: name.trim().slice(0, 40) || "Custom",
      cols: clampGridSize(cols),
      rows: clampGridSize(rows),
      ...(slots && { slots: slots.map((slot) => ({ ...slot })) }),
    };
    customLayouts.value = [...customLayouts.value, def];
    return def;
  };

  const deleteCustomLayout = (id: string): void => {
    customLayouts.value = customLayouts.value.filter((c) => c.id !== id);
    const { streamLayout } = usePreferences();
    if (streamLayout.value === id) {
      streamLayout.value = DEFAULT_LAYOUT;
    }
  };

  return {
    customLayouts,
    saveCustomLayout,
    deleteCustomLayout,
  };
};

export const useCustomLayouts = createSharedComposable(_useCustomLayouts);
