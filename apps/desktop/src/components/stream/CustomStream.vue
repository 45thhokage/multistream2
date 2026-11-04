<script setup lang="ts">
import { computed } from "vue";
import BaseStream from "./BaseStream.vue";
import BrowserTile from "./BrowserTile.vue";
import { customEmbedRoute } from "@/lib/customEmbed";

const props = defineProps<{
  channel: string;
  channelid: string;
  iframeUrl: string;
}>();

const route = computed(() => customEmbedRoute(props.iframeUrl));
</script>

<template>
  <BrowserTile
    v-if="route.kind === 'browser'"
    :channel="channel"
    :channelid="channelid"
    :iframe-url="route.url"
  />
  <BaseStream
    v-else
    :channelid="channelid"
    :channel="channel"
    platform="custom"
    :site-url="route.url"
    :iframe-url="route.url"
  >
    <iframe
      v-if="route.url"
      :title="`Custom Stream: ${channel}`"
      :src="route.url"
      allowfullscreen
      allow="autoplay; encrypted-media; fullscreen"
    />
  </BaseStream>
</template>
