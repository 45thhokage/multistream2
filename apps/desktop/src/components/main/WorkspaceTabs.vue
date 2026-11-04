<script setup lang="ts">
import { ref, nextTick, computed } from "vue";
import { Plus, X } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { useStreams } from "@/composables/useStreams";
import { useWorkspaces } from "@/composables/useWorkspaces";
import { useFocusedStream } from "@/composables/useFocusedStream";
import { usePreferences } from "@/composables/usePreferences";

const { t } = useI18n();
const { streams } = useStreams();
const {
  workspaces,
  activeWorkspaceId,
  addWorkspace,
  renameWorkspace,
  deleteWorkspace,
  switchWorkspace,
  workspaceIdOf,
} = useWorkspaces();
const { clearFocus } = useFocusedStream();
const { selectedChat, setSelectedChat } = usePreferences();

const editingId = ref<string | null>(null);
const editingName = ref("");
const editInput = ref<HTMLInputElement | null>(null);

const countFor = (workspaceId: string) =>
  streams.value.filter((s) => workspaceIdOf(s.workspaceId) === workspaceId).length;

const chatableIn = (workspaceId: string) =>
  streams.value.filter(
    (s) => workspaceIdOf(s.workspaceId) === workspaceId && s.platform !== "custom"
  );

function select(id: string) {
  if (id === activeWorkspaceId.value) return;
  switchWorkspace(id);
  clearFocus();
  const current = selectedChat.value;
  const available = chatableIn(id);
  if (!available.some((s) => `${s.platform}:${s.channel}` === current)) {
    const first = available[0];
    setSelectedChat(first ? `${first.platform}:${first.channel}` : "");
  }
}

function startRename(id: string, currentName: string) {
  editingId.value = id;
  editingName.value = currentName;
  nextTick(() => editInput.value?.select());
}

function commitRename(id: string) {
  if (editingId.value !== id) return;
  renameWorkspace(id, editingName.value);
  editingId.value = null;
}

function cancelRename() {
  editingId.value = null;
}

const showTabs = computed(() => workspaces.value.length > 1);
</script>

<template>
  <div data-testid="workspace-tabs" class="flex items-center gap-1 min-w-0">
    <span class="text-[10px] font-semibold tracking-widest uppercase text-gray-500 mr-1 shrink-0">
      {{ t("workspaces.title") }}
    </span>
    <template v-if="showTabs">
      <div
        v-for="ws in workspaces"
        :key="ws.id"
        data-testid="workspace-tab"
        :data-workspace-id="ws.id"
        :aria-label="ws.name"
        :aria-pressed="ws.id === activeWorkspaceId"
        role="button"
        tabindex="0"
        class="group flex items-center gap-1.5 h-8 pl-2.5 pr-1.5 rounded-lg border transition-colors cursor-pointer max-w-36"
        :class="
          ws.id === activeWorkspaceId
            ? 'border-[#3b82f6] bg-[#3b82f6]/10 text-white'
            : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'
        "
        @click="select(ws.id)"
        @keydown.enter="select(ws.id)"
        @dblclick="startRename(ws.id, ws.name)"
      >
        <input
          v-if="editingId === ws.id"
          :ref="
            (el) => {
              if (el) editInput = el as HTMLInputElement;
            }
          "
          v-model="editingName"
          data-testid="workspace-rename-input"
          class="w-20 bg-[#0f1115] border border-[#3b82f6] rounded px-1 text-xs text-white outline-none"
          maxlength="24"
          @click.stop
          @keydown.enter="commitRename(ws.id)"
          @keydown.escape="cancelRename"
          @blur="commitRename(ws.id)"
        />
        <span v-else class="text-xs font-medium truncate">{{ ws.name }}</span>
        <span
          class="text-[10px] tabular-nums rounded-full px-1.5 py-0.5 leading-none"
          :class="
            ws.id === activeWorkspaceId ? 'bg-[#3b82f6]/20 text-white' : 'bg-white/5 text-gray-500'
          "
        >
          {{ countFor(ws.id) }}
        </span>
        <button
          v-if="workspaces.length > 1"
          data-testid="workspace-delete"
          :aria-label="t('workspaces.delete')"
          class="hidden group-hover:flex items-center justify-center size-4 rounded-full text-gray-500 hover:text-white hover:bg-red-500/80 transition-colors cursor-pointer shrink-0"
          @click.stop="deleteWorkspace(ws.id)"
        >
          <X class="size-2.5" />
        </button>
      </div>
    </template>
    <button
      data-testid="workspace-add"
      :aria-label="t('workspaces.add')"
      :title="t('workspaces.add')"
      class="flex items-center justify-center size-8 rounded-lg border border-dashed border-[#3a3f4b] text-gray-500 hover:text-white hover:border-[#5b8def] hover:bg-[#3b82f6]/10 transition-colors cursor-pointer shrink-0"
      @click="addWorkspace()"
    >
      <Plus class="size-4" />
    </button>
  </div>
</template>
