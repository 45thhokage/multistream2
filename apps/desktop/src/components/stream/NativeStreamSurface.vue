<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useIntervalFn } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import { useBrowserTiles } from "@/composables/useBrowserTiles";
import { useStreams } from "@/composables/useStreams";
import { useStreamMixer } from "@/composables/useStreamMixer";
import { useWorkspaces } from "@/composables/useWorkspaces";

const props = defineProps<{ streamId: string; visible: boolean; dead?: boolean }>();
const failed = ref(false);
let nextAttempt = 0;
const viewport = ref<HTMLElement | null>(null);
const { openTile, closeTile, syncTileBounds, setTileVisible } = useBrowserTiles();
const { streams } = useStreams();
const { workspaceIdOf } = useWorkspaces();
const { effectiveAudio } = useStreamMixer();
let opened = false;
let opening = false;
let disposed = false;
let previousBounds = "";

const sync = async () => {
  if (props.dead || disposed) {
    if (opened) {
      opened = false;
      await closeTile(props.streamId);
    }
    return;
  }
  const box = viewport.value?.getBoundingClientRect();
  if (!box || box.width < 2 || box.height < 2 || opening) return;
  const rect = { x: box.x, y: box.y, width: box.width, height: box.height };
  setTileVisible(props.streamId, props.visible);
  if (!opened) {
    if (Date.now() < nextAttempt) return;
    nextAttempt = Date.now() + 5000;
    opening = true;
    try {
      opened = await openTile(props.streamId, "", rect, false, true);
      failed.value = !opened;
      if (disposed || props.dead) {
        await closeTile(props.streamId);
        opened = false;
        return;
      }
      const stream = streams.value.find((item) => item.id === props.streamId);
      if (opened && stream) {
        const workspaceId = workspaceIdOf(stream.workspaceId);
        const ids = streams.value
          .filter((item) => workspaceIdOf(item.workspaceId) === workspaceId)
          .map((item) => item.id);
        await invoke("tile_set_audio", {
          tileId: props.streamId,
          ...effectiveAudio(props.streamId, workspaceId, ids),
        });
      }
    } finally {
      opening = false;
    }
  }
  const key = JSON.stringify(rect);
  if (opened && key !== previousBounds) {
    previousBounds = key;
    await syncTileBounds(props.streamId, rect);
  }
  setTileVisible(props.streamId, props.visible);
};
const synchronize = () => {
  void sync().catch(() => {
    failed.value = true;
  });
};
watch(() => [props.visible, props.dead], synchronize, { flush: "post" });
useIntervalFn(synchronize, 200, { immediateCallback: true });
onBeforeUnmount(() => {
  disposed = true;
  if (opened) void closeTile(props.streamId);
});
</script>

<template>
  <div ref="viewport" class="absolute inset-0" :data-native-stream="streamId">
    <p v-if="failed" role="alert" class="p-3 text-xs text-gray-400">
      {{ $t("mixer.outputFailed") }}
    </p>
  </div>
</template>
