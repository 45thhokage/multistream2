<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { onClickOutside } from "@vueuse/core";
import { ChevronDown, Plus, X } from "@lucide/vue";
import {
  LAYOUTS,
  getLayoutSlots,
  customLayoutSlots,
  displaySlots,
  compileLayout,
  gridDimensionsFromContainer,
  resolveLayout,
  DEFAULT_LAYOUT,
  type LayoutGroup,
  type LayoutDef,
} from "@/config/layouts";
import { useCustomLayouts } from "@/composables/useCustomLayouts";
import { usePreferences } from "@/composables/usePreferences";
import { useStreams } from "@/composables/useStreams";
import { useI18n } from "vue-i18n";
import LayoutPreview from "./LayoutPreview.vue";
import { useNativeOverlay } from "@/composables/useNativeOverlay";

const props = defineProps<{ panelOnly?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const native = useNativeOverlay("layout");

const { streamLayout } = usePreferences();
const { customLayouts, saveCustomLayout, deleteCustomLayout } = useCustomLayouts();
const { activeStreams } = useStreams();
const { t } = useI18n();
const open = ref(!!props.panelOnly);
watch(open, (value) => {
  if (props.panelOnly || !native.available) return;
  if (!value) {
    native.close();
    return;
  }
  const box = triggerRef.value?.getBoundingClientRect();
  if (!box) return;
  const width = Math.min(480, window.innerWidth - 32);
  native.show({
    x: Math.max(8, box.right - width),
    y: box.bottom + 8,
    width,
    height: Math.min(window.innerHeight - box.bottom - 16, window.innerHeight * 0.7, 576),
  });
});
watch(native.opened, (value) => {
  if (!value && !props.panelOnly) open.value = false;
});
const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
onClickOutside(rootRef, () => {
  open.value = false;
});
const groups: LayoutGroup[] = ["grid", "focus", "pip"];
const grouped = computed(() =>
  groups.map((id) => ({
    id,
    layouts: LAYOUTS.filter((layout) => layout.id !== "auto" && layout.group === id),
  }))
);
const activeCustom = computed(() =>
  customLayouts.value.find((layout) => layout.id === streamLayout.value)
);
const activeBuiltin = computed(() =>
  LAYOUTS.find((layout) => layout.id === resolveLayout(streamLayout.value))
);
const activeId = computed(
  () => activeCustom.value?.id ?? activeBuiltin.value?.id ?? DEFAULT_LAYOUT
);
const label = (layout: LayoutDef) => t(layout.labelKey, layout.labelParams ?? {});
const currentLabel = computed(
  () => activeCustom.value?.name ?? (activeBuiltin.value ? label(activeBuiltin.value) : "")
);
const selectedSlots = computed(() =>
  activeCustom.value
    ? customLayoutSlots(activeCustom.value)
    : getLayoutSlots(resolveLayout(streamLayout.value), activeStreams.value.length)
);
const currentSlots = computed(() => displaySlots(selectedSlots.value, activeStreams.value.length));
const expanded = computed(() => currentSlots.value.length !== selectedSlots.value.length);
const autoSlots = computed(() => getLayoutSlots("auto", activeStreams.value.length));

function close() {
  open.value = false;
  emit("close");
  triggerRef.value?.focus();
}
function pick(id: string) {
  streamLayout.value = id;
  close();
}
function saveCurrent() {
  const dims = gridDimensionsFromContainer(compileLayout(currentSlots.value).container);
  const base = t("layouts.savedName", { name: currentLabel.value });
  const names = new Set(customLayouts.value.map((layout) => layout.name));
  let name = base;
  let index = 2;
  while (names.has(name)) name = `${base} (${index++})`;
  const saved = saveCustomLayout(name, dims.cols, dims.rows, currentSlots.value);
  streamLayout.value = saved.id;
}
</script>

<template>
  <div ref="rootRef" class="relative" @keydown.esc.stop.prevent="close">
    <button
      v-if="!panelOnly"
      ref="triggerRef"
      type="button"
      data-testid="layout-picker-btn"
      :aria-label="t('layouts.title')"
      :aria-expanded="open"
      aria-controls="layout-picker-panel"
      class="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-[#2a2d33] bg-[#1e2127] text-gray-200 hover:bg-[#24272e] hover:border-[#3a3f4b] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      @click="open = !open"
    >
      <LayoutPreview :slots="currentSlots" active class="!w-7" />
      <span class="text-xs font-medium max-w-36 truncate">{{ currentLabel }}</span>
      <ChevronDown
        class="size-3.5 text-gray-400 transition-transform"
        :class="open ? 'rotate-180' : ''"
        aria-hidden="true"
      />
    </button>
    <Transition name="layout-panel">
      <div
        v-if="open && (panelOnly || !native.available)"
        id="layout-picker-panel"
        data-testid="layout-panel"
        :data-native-overlay="!native.available ? true : undefined"
        role="region"
        :aria-label="t('layouts.title')"
        :class="
          panelOnly
            ? 'h-screen w-screen'
            : 'absolute right-0 top-full mt-2 z-50 w-[min(30rem,calc(100vw-2rem))] max-h-[min(70vh,36rem)]'
        "
        class="overflow-y-auto overscroll-contain rounded-xl border border-[#2a2d33] bg-[#14161a] p-3 space-y-4 custom-scrollbar"
      >
        <button
          type="button"
          data-testid="layout-option-auto"
          :aria-pressed="activeId === 'auto'"
          :aria-label="t('layouts.auto')"
          class="w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          :class="
            activeId === 'auto'
              ? 'border-gray-400 bg-[#2a2d33]'
              : 'border-[#2a2d33] hover:bg-[#1e2127]'
          "
          @click="pick('auto')"
        >
          <LayoutPreview :slots="autoSlots" :active="activeId === 'auto'" class="!w-16 shrink-0" />
          <span class="min-w-0"
            ><span class="block text-sm font-medium text-gray-100">{{ t("layouts.auto") }}</span
            ><span class="block text-xs text-gray-400 mt-0.5">{{
              t("layouts.autoHint")
            }}</span></span
          >
        </button>
        <p
          v-if="expanded"
          data-testid="layout-expanded-notice"
          class="text-xs text-gray-300 leading-relaxed"
        >
          {{ t("layouts.expandedHint", { count: activeStreams.length }) }}
        </p>
        <section
          v-for="group in grouped"
          :key="group.id"
          :aria-label="t(`layouts.groups.${group.id}`)"
        >
          <h3 class="text-xs font-medium text-gray-300 mb-2">
            {{ t(`layouts.groups.${group.id}`) }}
          </h3>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="layout in group.layouts"
              :key="layout.id"
              type="button"
              :data-testid="`layout-option-${layout.id}`"
              :aria-label="label(layout)"
              :aria-pressed="activeId === layout.id"
              :title="`${label(layout)} · ${t('layouts.slotCount', { count: layout.slots.length })}`"
              class="flex flex-col gap-1.5 rounded-lg border p-1.5 min-w-0 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              :class="
                activeId === layout.id
                  ? 'border-gray-400 bg-[#2a2d33]'
                  : 'border-transparent hover:bg-[#1e2127]'
              "
              @click="pick(layout.id)"
            >
              <LayoutPreview :slots="layout.slots" :active="activeId === layout.id" />
              <span class="flex items-start justify-between gap-1 w-full"
                ><span class="text-[11px] leading-tight text-gray-300 break-words">{{
                  label(layout)
                }}</span
                ><span class="text-[10px] tabular-nums text-gray-400 shrink-0">{{
                  layout.slots.length
                }}</span></span
              >
            </button>
          </div>
        </section>
        <section v-if="customLayouts.length" :aria-label="t('layouts.groups.saved')">
          <h3 class="text-xs font-medium text-gray-300 mb-2">{{ t("layouts.groups.saved") }}</h3>
          <div class="grid grid-cols-4 gap-2">
            <div
              v-for="custom in customLayouts"
              :key="custom.id"
              class="relative group/custom min-w-0"
            >
              <button
                type="button"
                :data-testid="`layout-option-${custom.id}`"
                :aria-label="custom.name"
                :aria-pressed="activeId === custom.id"
                class="w-full flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                :class="
                  activeId === custom.id
                    ? 'border-gray-400 bg-[#2a2d33]'
                    : 'border-transparent hover:bg-[#1e2127]'
                "
                @click="pick(custom.id)"
              >
                <LayoutPreview
                  :slots="customLayoutSlots(custom)"
                  :active="activeId === custom.id"
                />
                <span
                  class="text-[11px] leading-tight text-gray-300 truncate w-full"
                  :title="custom.name"
                  >{{ custom.name }}</span
                >
              </button>
              <button
                type="button"
                :aria-label="t('layouts.deleteCustom')"
                class="absolute top-0 right-0 flex items-center justify-center size-6 rounded-full bg-[#2a2d33] text-gray-300 opacity-0 group-hover/custom:opacity-100 group-focus-within/custom:opacity-100 hover:bg-[#3a3f4b] focus-visible:opacity-100 cursor-pointer"
                @click.stop="deleteCustomLayout(custom.id)"
              >
                <X class="size-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
        <button
          type="button"
          data-testid="layout-save-current"
          class="w-full flex items-center justify-center gap-2 h-9 rounded-lg border border-[#3a3f4b] text-xs text-gray-300 hover:text-white hover:bg-[#1e2127] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          @click="saveCurrent"
        >
          <Plus class="size-3.5" aria-hidden="true" />{{ t("layouts.saveCurrent") }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.layout-panel-enter-active,
.layout-panel-leave-active {
  transition:
    opacity 120ms ease-out,
    transform 120ms ease-out;
}
.layout-panel-enter-from,
.layout-panel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@media (prefers-reduced-motion: reduce) {
  .layout-panel-enter-active,
  .layout-panel-leave-active {
    transition: none;
  }
}
</style>
