import { effectScope, EffectScope } from "vue";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkspaces, MAX_WORKSPACES } from "../useWorkspaces";
import { toast } from "@/composables/useToast";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.n !== undefined ? `${key}:${params.n}` : key,
  }),
}));

vi.mock("@/composables/useToast", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

describe("useWorkspaces composable unit tests", () => {
  let scope: EffectScope;
  let sut: ReturnType<typeof useWorkspaces>;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    scope = effectScope();
    sut = scope.run(() => useWorkspaces())!;
  });

  afterEach(() => {
    scope?.stop();
  });

  it("should seed a default workspace and activate it when storage is empty", () => {
    // Arrange & Act (seeding happens on first use)
    const { workspaces, activeWorkspace } = sut;

    // Assert
    expect(workspaces.value).toHaveLength(1);
    expect(activeWorkspace.value.id).toBe(workspaces.value[0]?.id);
  });

  it("should create and activate a new workspace with a non-colliding name", () => {
    // Arrange
    const { addWorkspace, workspaces, activeWorkspaceId } = sut;

    // Act
    const created = addWorkspace();
    const activeAfterFirstAdd = activeWorkspaceId.value;
    const second = addWorkspace("Custom");

    // Assert
    expect(workspaces.value).toHaveLength(3);
    expect(created?.id).toBe(activeAfterFirstAdd);
    expect(second?.id).toBe(activeWorkspaceId.value);
    expect(second?.name).toBe("Custom");
    expect(new Set(workspaces.value.map((w) => w.name)).size).toBe(3);
  });

  it("should refuse to exceed the workspace cap", () => {
    // Arrange
    const { addWorkspace, workspaces } = sut;

    // Act
    for (let i = 1; i < MAX_WORKSPACES; i++) addWorkspace();
    const overflow = addWorkspace();

    // Assert
    expect(workspaces.value).toHaveLength(MAX_WORKSPACES);
    expect(overflow).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith("workspaces.maxReached");
  });

  it("should rename workspaces while trimming and ignoring empty names", () => {
    // Arrange
    const { renameWorkspace, workspaces } = sut;
    const id = workspaces.value[0]?.id as string;

    // Act
    renameWorkspace(id, "  Chill Room  ");
    const afterValid = workspaces.value[0]?.name;
    renameWorkspace(id, "   ");
    const afterEmpty = workspaces.value[0]?.name;

    // Assert
    expect(afterValid).toBe("Chill Room");
    expect(afterEmpty).toBe("Chill Room");
  });

  it("should delete a workspace and move activation to a survivor", () => {
    // Arrange
    const { addWorkspace, deleteWorkspace, workspaces, activeWorkspaceId, switchWorkspace } = sut;
    const firstId = workspaces.value[0]?.id as string;
    const second = addWorkspace()!;
    switchWorkspace(firstId);

    // Act
    const removed = deleteWorkspace(firstId);

    // Assert
    expect(removed).toBe(true);
    expect(workspaces.value).toHaveLength(1);
    expect(workspaces.value[0]?.id).toBe(second.id);
    expect(activeWorkspaceId.value).toBe(second.id);
    expect(toast.success).toHaveBeenCalled();
  });

  it("should refuse to delete the last workspace", () => {
    // Arrange
    const { deleteWorkspace, workspaces } = sut;
    const id = workspaces.value[0]?.id as string;

    // Act
    const removed = deleteWorkspace(id);

    // Assert
    expect(removed).toBe(false);
    expect(workspaces.value).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith("workspaces.cannotDeleteLast");
  });

  it("should ignore switching to an unknown workspace", () => {
    // Arrange
    const { switchWorkspace, activeWorkspaceId } = sut;
    const before = activeWorkspaceId.value;

    // Act
    switchWorkspace("nope");

    // Assert
    expect(activeWorkspaceId.value).toBe(before);
  });

  it("should resolve legacy or unknown workspace ids to the first workspace", () => {
    // Arrange
    const { workspaceIdOf, workspaces } = sut;
    const firstId = workspaces.value[0]?.id as string;

    // Act & Assert
    expect(workspaceIdOf(undefined)).toBe(firstId);
    expect(workspaceIdOf("ghost")).toBe(firstId);
    expect(workspaceIdOf(firstId)).toBe(firstId);
  });
});
