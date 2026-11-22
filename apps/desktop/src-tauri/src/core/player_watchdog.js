(() => {
  const host = window.location.hostname;
  if (!["player.twitch.tv", "player.kick.cx", "player.kick.com"].includes(host)) return;

  const STALL_MS = 20000;
  const MAX_RELOADS = 3;
  const channel = new URLSearchParams(window.location.search).get("channel") || "";
  const key = `multistream-stall:${host}${window.location.pathname}:${channel}`;
  const storage = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();
  // Without a persisted counter a reload could never be bounded.
  if (!storage) return;

  const reloads = () => Number(storage.getItem(key)) || 0;
  let lastTime = -1;
  let lastProgress = Date.now();
  let timer = 0;
  const stop = () => {
    clearInterval(timer);
    document.removeEventListener("pointerdown", interaction, true);
    document.removeEventListener("keydown", interaction, true);
  };
  function interaction(event) {
    if (event?.isTrusted !== false) stop();
  }
  const check = () => {
    if (window.__isGraveyard) return stop();
    const video = document.querySelector("video");
    if (video && !video.paused && video.readyState >= 2 && video.currentTime > lastTime + 0.1) {
      lastTime = video.currentTime;
      lastProgress = Date.now();
      if (reloads()) storage.removeItem(key);
      return;
    }
    // A pause after real playback is the viewer's choice, not a stalled load.
    if (video && video.paused && video.readyState >= 2 && video.currentTime > 0) return stop();
    const count = reloads();
    if (count >= MAX_RELOADS) return stop();
    if (Date.now() - lastProgress < STALL_MS * (count + 1)) return;
    storage.setItem(key, String(count + 1));
    stop();
    window.location.reload();
  };
  timer = setInterval(check, 2000);
  document.addEventListener("pointerdown", interaction, true);
  document.addEventListener("keydown", interaction, true);
})();
