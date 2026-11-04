import { computed } from "vue";
import { createSharedComposable, useStorage } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { toast } from "@/composables/useToast";

export interface Workspace {
  id: string;
  name: string;
}

export const MAX_WORKSPACES = 5;
export const DEFAULT_WORKSPACE_ID = "default";

const _useWorkspaces = () => {
  const { t } = useI18n();
  const workspaces = useStorage<Workspace[]>("multistream-workspaces", []);
  const activeWorkspaceId = useStorage<string>(
    "multistream-active-workspace",
    DEFAULT_WORKSPACE_ID
  );

  if (workspaces.value.length === 0) {
    workspaces.value = [{ id: DEFAULT_WORKSPACE_ID, name: t("workspaces.roomName", { n: 1 }) }];
  }

  const activeWorkspace = computed<Workspace>(() => {
    const found = workspaces.value.find((w) => w.id === activeWorkspaceId.value);
    if (found) return found;
    const first = workspaces.value[0];
    if (first) {
      activeWorkspaceId.value = first.id;
      return first;
    }
    const seeded: Workspace = {
      id: DEFAULT_WORKSPACE_ID,
      name: t("workspaces.roomName", { n: 1 }),
    };
    workspaces.value = [seeded];
    activeWorkspaceId.value = seeded.id;
    return seeded;
  });

  const nextRoomName = (): string => {
    const taken = new Set(workspaces.value.map((w) => w.name));
    for (
      let n = workspaces.value.length + 1;
      n <= workspaces.value.length + MAX_WORKSPACES + 1;
      n++
    ) {
      const name = t("workspaces.roomName", { n });
      if (!taken.has(name)) return name;
    }
    return `${t("workspaces.roomName", { n: workspaces.value.length + 1 })} ${Math.floor(
      Math.random() * 1296
    ).toString(36)}`;
  };

  const addWorkspace = (name?: string): Workspace | null => {
    if (workspaces.value.length >= MAX_WORKSPACES) {
      toast.warning(t("workspaces.maxReached"));
      return null;
    }
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: (name ?? "").trim().slice(0, 24) || nextRoomName(),
    };
    workspaces.value = [...workspaces.value, workspace];
    activeWorkspaceId.value = workspace.id;
    return workspace;
  };

  const renameWorkspace = (id: string, name: string): void => {
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return;
    workspaces.value = workspaces.value.map((w) => (w.id === id ? { ...w, name: trimmed } : w));
  };

  const deleteWorkspace = (id: string): boolean => {
    if (workspaces.value.length <= 1) {
      toast.warning(t("workspaces.cannotDeleteLast"));
      return false;
    }
    const target = workspaces.value.find((w) => w.id === id);
    const remaining = workspaces.value.filter((w) => w.id !== id);
    workspaces.value = remaining;
    if (activeWorkspaceId.value === id) {
      activeWorkspaceId.value = remaining.at(0)?.id ?? DEFAULT_WORKSPACE_ID;
    }
    if (target) toast.success(`${target.name} ${t("workspaces.deleted")}`);
    return true;
  };

  const switchWorkspace = (id: string): void => {
    if (!workspaces.value.some((w) => w.id === id)) return;
    activeWorkspaceId.value = id;
  };

  const workspaceIdOf = (workspaceId: string | undefined): string =>
    workspaces.value.some((w) => w.id === workspaceId)
      ? (workspaceId as string)
      : (workspaces.value[0]?.id ?? DEFAULT_WORKSPACE_ID);

  return {
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    addWorkspace,
    renameWorkspace,
    deleteWorkspace,
    switchWorkspace,
    workspaceIdOf,
  };
};

export const useWorkspaces = createSharedComposable(_useWorkspaces);
