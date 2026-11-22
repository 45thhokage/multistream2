(() => {
  const host = window.location.hostname;
  const twitch = host === "player.twitch.tv";
  const kick = ["player.kick.cx", "player.kick.com"].includes(host);
  const autoplay = new URLSearchParams(window.location.search).get("autoplay");
  if (
    (!twitch && !kick) ||
    autoplay === "false" ||
    autoplay === "0" ||
    (twitch && autoplay !== "true")
  )
    return;

  let stopped = false;
  let started = false;
  const pending = new WeakSet();
  const clicked = new WeakSet();
  const initialTimes = new WeakMap();
  let lastControllerAttempt = 0;
  const observer = new MutationObserver(() => attempt());
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(deadline);
    observer.disconnect();
    document.removeEventListener("playing", markStarted, true);
    for (const name of ["loadedmetadata", "canplay", "playing"])
      document.removeEventListener(name, attempt, true);
    for (const name of ["pointerdown", "keydown"])
      document.removeEventListener(name, interaction, true);
  };
  const interaction = (event) => {
    if (event?.isTrusted !== false) stop();
  };
  const playMedia = (video) => {
    if (pending.has(video) || video.ended || !video.paused) return;
    pending.add(video);
    video
      .play()
      .catch((error) => {
        if (stopped || window.__isGraveyard) return;
        if (error?.name === "NotAllowedError" && !video.muted) {
          // Unmuting without a gesture can immediately pause a browser-blocked player again.
          video.muted = true;
        }
      })
      .finally(() => pending.delete(video));
  };
  function startController() {
    const queue = [],
      seen = new Set();
    const add = (value, depth) => {
      if (!value || !["object", "function"].includes(typeof value) || seen.has(value)) return;
      seen.add(value);
      queue.push({ value, depth });
    };
    for (const node of document.querySelectorAll("#root, #__next, video")) {
      for (let parent = node, i = 0; parent && i < 10; i++, parent = parent.parentElement) {
        add(parent.player, 0);
        add(parent.player_, 0);
        for (const key of Object.keys(parent))
          if (/^__react(Fiber|Props|Container|InternalInstance)/.test(key)) add(parent[key], 0);
      }
    }
    add(window.player, 0);
    add(window.ivsPlayer, 0);
    for (let i = 0; i < queue.length && i < 500; i++) {
      const { value, depth } = queue[i];
      try {
        if (
          typeof value.play === "function" &&
          (typeof value.getQualities === "function" || typeof value.getState === "function")
        ) {
          const result = value.play();
          result?.catch?.(() => {});
          return;
        }
        if (depth >= 12) continue;
        for (const key of [
          "player",
          "playerInstance",
          "mediaPlayerInstance",
          "mediaPlayer",
          "core",
          "current",
          "ref",
          "refs",
          "props",
          "memoizedProps",
          "memoizedState",
          "stateNode",
          "state",
          "next",
          "return",
          "child",
          "sibling",
        ])
          add(value[key], depth + 1);
        if (Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 24)
          Object.values(value).forEach((v) => add(v, depth + 1));
      } catch {
        /* Framework refs can disappear while the player initializes. */
      }
    }
  }
  const attempt = () => {
    if (stopped) return;
    if (window.__isGraveyard) {
      stop();
      return;
    }
    const video = document.querySelector("video");
    if (video) {
      // A pause after playback began is the viewer's choice, not a failed startup.
      if (started && video.paused) {
        stop();
        return;
      }
      if (!initialTimes.has(video)) initialTimes.set(video, video.currentTime || 0);
      if (
        !video.paused &&
        video.readyState >= 2 &&
        video.currentTime > initialTimes.get(video) + 0.25
      ) {
        stop();
        return;
      }
    }
    // Twitch's overlay initializes its controller and media source; video.play() alone cannot.
    const overlay =
      twitch && document.querySelector('[data-a-target="player-overlay-play-button"]');
    if (overlay && !overlay.disabled && !clicked.has(overlay)) {
      clicked.add(overlay);
      overlay.click();
    }
    if (
      video &&
      (!video.currentSrc || video.paused) &&
      Date.now() - lastControllerAttempt >= 1000
    ) {
      lastControllerAttempt = Date.now();
      startController();
    }
    if (video) playMedia(video);
  };
  const markStarted = () => {
    started = true;
  };
  const timer = setInterval(attempt, 500);
  const deadline = setTimeout(stop, 30000);
  document.addEventListener("playing", markStarted, true);
  for (const name of ["loadedmetadata", "canplay", "playing"])
    document.addEventListener(name, attempt, true);
  for (const name of ["pointerdown", "keydown"]) document.addEventListener(name, interaction, true);
  if (document.documentElement)
    observer.observe(document.documentElement, { childList: true, subtree: true });
  attempt();
})();
