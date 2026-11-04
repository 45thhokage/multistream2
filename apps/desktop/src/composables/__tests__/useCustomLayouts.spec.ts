import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { useCustomLayouts } from "../useCustomLayouts";
import { usePreferences } from "../usePreferences";
import { DEFAULT_LAYOUT } from "@/config/layouts";
import { getLayoutSlots } from "@/config/layouts";

const mockLayout = ref<string>(DEFAULT_LAYOUT);

vi.mock("../usePreferences", () => ({
  usePreferences: () => ({ streamLayout: mockLayout }),
}));

describe("useCustomLayouts composable unit tests", () => {
  let sut: ReturnType<typeof useCustomLayouts>;

  beforeEach(() => {
    localStorage.clear();
    mockLayout.value = DEFAULT_LAYOUT;
    sut = useCustomLayouts();
  });

  it("should save a custom layout with clamped dimensions", () => {
    // Arrange
    const { saveCustomLayout, customLayouts } = sut;

    // Act
    const def = saveCustomLayout("  Custom 2x2  ", 2, 9);

    // Assert
    expect(def.id).toMatch(/^custom-/);
    expect(def.name).toBe("Custom 2x2");
    expect(def.cols).toBe(2);
    expect(def.rows).toBe(6);
    expect(customLayouts.value.length).toBe(1);
  });

  it("should delete a custom layout", () => {
    // Arrange
    const { saveCustomLayout, deleteCustomLayout, customLayouts } = sut;
    const first = saveCustomLayout("First", 2, 2);
    saveCustomLayout("Second", 3, 2);

    // Act
    deleteCustomLayout(first.id);

    // Assert
    expect(customLayouts.value.map((c) => c.name)).toEqual(["Second"]);
  });

  it("should snapshot pane sizes and overlays without sharing the source array", () => {
    // Arrange
    const slots = structuredClone(getLayoutSlots("pip-2-corners"));
    const expected = structuredClone(slots);

    // Act
    const saved = sut.saveCustomLayout("My PiP", 3, 3, slots);
    if (slots[1]) slots[1].x = 0.5;
    slots.pop();

    // Assert
    expect(saved.slots).toEqual(expected);
    expect(sut.customLayouts.value[0]?.slots).toEqual(expected);
  });

  it("should reset the active layout when the selected custom is deleted", () => {
    // Arrange
    const { saveCustomLayout, deleteCustomLayout } = sut;
    const { streamLayout } = usePreferences();
    const def = saveCustomLayout("Mine", 2, 2);
    streamLayout.value = def.id;

    // Act
    deleteCustomLayout(def.id);

    // Assert
    expect(streamLayout.value).toBe(DEFAULT_LAYOUT);
  });
});
