<script setup lang="ts">
/** Saved lineups (adapted from Multi Worldview's Presets section, MIT). */
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Check, Pencil, Pin, PinOff, Plus, X } from "@lucide/vue";
import { usePresets } from "@/composables/usePresets";
import { useStreams } from "@/composables/useStreams";

const { t } = useI18n();
const { presets, saveCurrent, apply, rename, togglePin, remove } = usePresets();
const { activeStreams } = useStreams();

const ordered = computed(() => [
  ...presets.value.filter((p) => p.pinned),
  ...presets.value.filter((p) => !p.pinned),
]);
const count = computed(() => activeStreams.value.length);

const naming = ref(false);
const newName = ref("");
const nameInput = ref<HTMLInputElement | null>(null);
const startSave = async () => {
  if (count.value === 0) return;
  naming.value = true;
  newName.value = "";
  await nextTick();
  nameInput.value?.focus();
};
const confirmSave = () => {
  saveCurrent(newName.value);
  naming.value = false;
};

const editingId = ref<string | null>(null);
const editName = ref("");
const startRename = async (id: string, name: string) => {
  editingId.value = id;
  editName.value = name;
  await nextTick();
  (document.querySelector(`[data-preset-rename="${id}"]`) as HTMLInputElement | null)?.select();
};
const commitRename = () => {
  if (editingId.value) rename(editingId.value, editName.value);
  editingId.value = null;
};

const input =
  "flex-1 min-w-0 h-8 px-2 rounded-md bg-[#191b1f] border border-[#2a2d33] text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-[#3a3f4b]";
const icon =
  "p-1 rounded text-gray-500 hover:text-white hover:bg-white/10 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity";
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="presets-section">
    <form v-if="naming" class="flex items-center gap-1.5" @submit.prevent="confirmSave">
      <input
        ref="nameInput"
        v-model="newName"
        data-testid="preset-name"
        type="text"
        maxlength="60"
        :class="input"
        :placeholder="t('sidebarSections.presets.namePlaceholder')"
        :aria-label="t('sidebarSections.presets.namePlaceholder')"
        @keydown.esc.stop.prevent="naming = false"
      />
      <button
        type="submit"
        data-testid="preset-save-confirm"
        class="p-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-500"
        :title="t('sidebarSections.presets.save')"
        :aria-label="t('sidebarSections.presets.save')"
      >
        <Check class="size-3.5" aria-hidden="true" />
      </button>
    </form>
    <button
      v-else
      type="button"
      data-testid="preset-save"
      class="w-full flex items-center justify-center gap-1.5 h-8 rounded-md border border-[#2a2d33] text-xs text-gray-300 hover:text-white hover:bg-[#1f2227] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      :disabled="count === 0"
      :title="
        count === 0
          ? t('sidebarSections.presets.addFirst')
          : t('sidebarSections.presets.saveTitle', { count })
      "
      @click="startSave"
    >
      <Plus class="size-3.5" aria-hidden="true" />
      {{
        count === 0
          ? t("sidebarSections.presets.saveEmpty")
          : t("sidebarSections.presets.saveAll", { count })
      }}
    </button>

    <p v-if="presets.length === 0" class="px-1 text-[11px] text-gray-500">
      {{ t("sidebarSections.presets.empty") }}
    </p>
    <div v-else class="flex flex-col gap-0.5">
      <div
        v-for="preset in ordered"
        :key="preset.id"
        class="group/row flex items-center gap-0.5 rounded-md hover:bg-[#1f2227] transition-colors"
      >
        <form
          v-if="editingId === preset.id"
          class="flex-1 flex items-center gap-1 p-0.5"
          @submit.prevent="commitRename"
        >
          <input
            v-model="editName"
            :data-preset-rename="preset.id"
            type="text"
            maxlength="60"
            :class="input"
            :aria-label="t('sidebarSections.presets.rename')"
            @blur="commitRename"
            @keydown.esc.stop.prevent="editingId = null"
          />
        </form>
        <button
          v-else
          type="button"
          :data-testid="`preset-row-${preset.name}`"
          class="flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1.5 text-left"
          :title="
            t('sidebarSections.presets.applyTitle', {
              count: preset.streams.length,
              name: preset.name,
            })
          "
          @click="apply(preset.id)"
        >
          <Pin v-if="preset.pinned" class="size-3 text-gray-500 shrink-0" aria-hidden="true" />
          <span class="flex-1 min-w-0 truncate text-sm font-medium text-gray-100">{{
            preset.name
          }}</span>
          <span class="text-[11px] tabular-nums text-gray-500">{{ preset.streams.length }}</span>
        </button>
        <template v-if="editingId !== preset.id">
          <button
            type="button"
            :class="icon"
            :title="preset.pinned ? t('favoritesPanel.unpin') : t('favoritesPanel.pin')"
            :aria-label="preset.pinned ? t('favoritesPanel.unpin') : t('favoritesPanel.pin')"
            @click="togglePin(preset.id)"
          >
            <component :is="preset.pinned ? PinOff : Pin" class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            :class="icon"
            :title="t('sidebarSections.presets.rename')"
            :aria-label="t('sidebarSections.presets.rename')"
            @click="startRename(preset.id, preset.name)"
          >
            <Pencil class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            :class="[icon, 'mr-1 hover:!text-red-300 hover:!bg-red-500/10']"
            :title="t('sidebarSections.presets.delete')"
            :aria-label="t('sidebarSections.presets.delete')"
            @click="remove(preset.id)"
          >
            <X class="size-3.5" aria-hidden="true" />
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
