<script setup lang="ts">
import { isOverlaySlot, type LayoutSlot } from "@/config/layouts";

defineProps<{ slots: LayoutSlot[]; active?: boolean }>();
</script>

<template>
  <span
    class="layout-preview relative block w-full aspect-video overflow-hidden rounded-sm bg-[#0f1115]"
    aria-hidden="true"
  >
    <span
      v-for="(slot, index) in slots"
      :key="index"
      :data-layout-slot="index"
      class="absolute box-border border border-[#0f1115] rounded-[2px]"
      :class="active ? 'bg-gray-300' : 'bg-gray-500'"
      :style="{
        left: `${slot.x * 100}%`,
        top: `${slot.y * 100}%`,
        width: `${slot.w * 100}%`,
        height: `${slot.h * 100}%`,
        zIndex: isOverlaySlot(slot, index, slots) ? index + 2 : 0,
      }"
    />
  </span>
</template>
