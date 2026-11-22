<script setup lang="ts">
/** The workspaces (adapted from Multi Worldview's Workspaces section, MIT). */
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LayoutGrid, Plus, X } from "@lucide/vue";
import { MAX_WORKSPACES, useWorkspaces } from "@/composables/useWorkspaces";
import { useStreams } from "@/composables/useStreams";

const { t } = useI18n();
const {
  workspaces,
  activeWorkspaceId,
  activeWorkspace,
  addWorkspace,
  renameWorkspace,
  deleteWorkspace,
  switchWorkspace,
  workspaceIdOf,
} = useWorkspaces();
const { streams } = useStreams();

const countOf = (id: string) =>
  streams.value.filter((s) => workspaceIdOf(s.workspaceId) === id).length;
const others = computed(() => workspaces.value.filter((w) => w.id !== activeWorkspaceId.value));

const editing = ref(false);
const editName = ref("");
const editInput = ref<HTMLInputElement | null>(null);
const startRename = async () => {
  editing.value = true;
  editName.value = activeWorkspace.value.name;
  await nextTick();
  editInput.value?.select();
};
const commitRename = () => {
  if (editing.value && editName.value.trim())
    renameWorkspace(activeWorkspace.value.id, editName.value.trim());
  editing.value = false;
};

const newName = ref("");
const create = () => {
  const created = addWorkspace(newName.value.trim() || undefined);
  if (created) {
    switchWorkspace(created.id);
    newName.value = "";
  }
};

const input =
  "flex-1 min-w-0 h-8 px-2 rounded-md bg-[#191b1f] border border-[#2a2d33] text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-[#3a3f4b]";
const close =
  "p-1 rounded text-gray-500 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity";
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="workspaces-section">
    <input
      v-if="editing"
      ref="editInput"
      v-model="editName"
      type="text"
      maxlength="40"
      :class="input"
      :aria-label="t('sidebarSections.workspaces.rename')"
      @blur="commitRename"
      @keydown.enter.prevent="commitRename"
      @keydown.esc.stop.prevent="editing = false"
    />
    <div
      v-else
      class="group/row flex items-center gap-1 rounded-md border border-[#2a2d33] bg-[#191b1f]"
    >
      <button
        type="button"
        data-testid="workspace-active"
        class="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left"
        :title="t('sidebarSections.workspaces.renameTitle')"
        @click="startRename"
      >
        <LayoutGrid class="size-3.5 text-gray-400 shrink-0" aria-hidden="true" />
        <span class="flex-1 min-w-0 truncate text-sm font-semibold text-gray-100">{{
          activeWorkspace.name
        }}</span>
        <span class="text-[11px] tabular-nums text-gray-500">{{
          countOf(activeWorkspace.id)
        }}</span>
      </button>
      <button
        v-if="workspaces.length > 1"
        type="button"
        :class="[close, 'mr-1']"
        :title="t('workspaces.delete')"
        :aria-label="t('workspaces.delete')"
        @click="deleteWorkspace(activeWorkspace.id)"
      >
        <X class="size-3.5" aria-hidden="true" />
      </button>
    </div>

    <form class="flex items-center gap-1.5" @submit.prevent="create">
      <input
        v-model="newName"
        data-testid="workspace-new-name"
        type="text"
        maxlength="40"
        :class="input"
        :disabled="workspaces.length >= MAX_WORKSPACES"
        :placeholder="
          workspaces.length >= MAX_WORKSPACES
            ? t('workspaces.maxReached')
            : t('sidebarSections.workspaces.newPlaceholder')
        "
        :aria-label="t('sidebarSections.workspaces.newPlaceholder')"
      />
      <button
        type="submit"
        data-testid="workspace-create"
        class="p-1.5 rounded-md border border-[#2a2d33] text-gray-300 hover:text-white hover:bg-[#1f2227] disabled:opacity-40"
        :disabled="workspaces.length >= MAX_WORKSPACES"
        :title="t('workspaces.add')"
        :aria-label="t('workspaces.add')"
      >
        <Plus class="size-3.5" aria-hidden="true" />
      </button>
    </form>

    <div v-if="others.length" class="flex flex-col gap-0.5">
      <div
        v-for="workspace in others"
        :key="workspace.id"
        class="group/row flex items-center rounded-md hover:bg-[#1f2227] transition-colors"
      >
        <button
          type="button"
          :data-testid="`workspace-row-${workspace.name}`"
          class="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left"
          :title="t('sidebarSections.workspaces.open')"
          @click="switchWorkspace(workspace.id)"
        >
          <span class="flex-1 min-w-0 truncate text-sm text-gray-300">{{ workspace.name }}</span>
          <span class="text-[11px] tabular-nums text-gray-500">{{ countOf(workspace.id) }}</span>
        </button>
        <button
          type="button"
          :class="[close, 'mr-1']"
          :title="t('workspaces.delete')"
          :aria-label="t('workspaces.delete')"
          @click="deleteWorkspace(workspace.id)"
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
