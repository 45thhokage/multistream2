<script setup lang="ts">
/**
 * A sidebar section header and body (adapted from Multi Worldview's SectionHead, MIT): icon,
 * title, count or badge, and the fold toggle. When the section is the one a tabbed sidebar shows
 * (`focused`) the header is a plain title, since there is nothing to fold it into. Extra buttons
 * go in the `actions` slot, outside the toggle, so a folded section can still be refreshed.
 */
import { computed, type Component } from "vue";
import { ChevronRight } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { useSidebarSections } from "@/composables/useSidebarSections";
import type { SidebarTab } from "@/composables/usePreferences";

const props = defineProps<{
  id: SidebarTab;
  icon: Component;
  title: string;
  count?: number;
  focused?: boolean;
}>();

const { t } = useI18n();
const sections = useSidebarSections();
const open = computed(() => props.focused || !sections.isCollapsed(props.id));
</script>

<template>
  <section
    :data-testid="`sidebar-section-${id}`"
    :data-sidebar-section="id"
    class="flex flex-col"
    :class="focused ? 'gap-2' : 'border-b border-[#1f2227] py-1'"
  >
    <h3 class="flex items-center gap-1 min-h-8" :class="focused ? '' : 'px-1'">
      <span
        v-if="focused"
        class="flex-1 min-w-0 flex items-center gap-2 text-[10.5px] font-semibold tracking-widest uppercase text-gray-400"
      >
        <span class="truncate">{{ title }}</span>
        <slot name="badge">
          <span
            v-if="count"
            class="rounded-full bg-[#1f2227] px-1.5 py-px text-[10px] tabular-nums text-gray-400"
            >{{ count }}</span
          >
        </slot>
      </span>
      <button
        v-else
        type="button"
        :data-testid="`sidebar-section-toggle-${id}`"
        :aria-expanded="open"
        :title="
          open
            ? t('sidebarSections.collapse', { name: title })
            : t('sidebarSections.expand', { name: title })
        "
        class="flex-1 min-w-0 flex items-center gap-2 rounded-md px-1 py-1 text-[10.5px] font-semibold tracking-widest uppercase text-gray-400 hover:text-gray-200 hover:bg-[#1a1d22] transition-colors"
        @click="sections.toggle(id)"
      >
        <component :is="icon" class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ title }}</span>
        <slot name="badge">
          <span
            v-if="count"
            class="rounded-full bg-[#1f2227] px-1.5 py-px text-[10px] tabular-nums text-gray-400"
            >{{ count }}</span
          >
        </slot>
        <ChevronRight
          class="ml-auto size-3.5 shrink-0 transition-transform"
          :class="open ? 'rotate-90' : ''"
          aria-hidden="true"
        />
      </button>
      <slot name="actions" />
    </h3>
    <div v-if="open" class="flex flex-col gap-2" :class="focused ? '' : 'px-1 pb-2'">
      <slot />
    </div>
  </section>
</template>
