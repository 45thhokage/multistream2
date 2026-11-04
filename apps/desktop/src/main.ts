import { createApp } from "vue";
import "./style.css";
import { i18n } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { nativePlayerId } from "./lib/nativePlayer";

const player = nativePlayerId();
const overlay = new URLSearchParams(location.search).get("nativeOverlay");
const component = player
  ? import("./components/stream/NativeTilePlayer.vue")
  : overlay
    ? import("./components/main/NativeOverlay.vue")
    : import("./App.vue");
component.then(({ default: App }) => {
  createApp(App).use(i18n).mount("#app");
  if (!player && !overlay)
    setTimeout(() => {
      invoke("close_splashscreen").catch(() => {});
    }, 250);
});
