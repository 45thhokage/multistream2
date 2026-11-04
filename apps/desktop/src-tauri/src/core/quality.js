(function () {
  if (window.__multistreamQualityInstalled) return;
  window.__multistreamQualityInstalled = true;
  const isTop = window === window.top;
  let requested = null;
  let serial = 0;
  let ownsPlayer = false;

  function report(value) {
    if (isTop) window.dispatchEvent(new CustomEvent("multistream-quality-state", { detail: value }));
    else window.parent.postMessage({ type: "MULTISTREAM_QUALITY_STATE", report: value }, "*");
  }

  function playerObjects() {
    const queue = [], seen = new Set(), found = [];
    const add = (value, depth) => {
      if (!value || !["object", "function"].includes(typeof value) || seen.has(value)) return;
      seen.add(value);
      queue.push({ value, depth });
    };
    add(window.player, 0);
    add(window.ivsPlayer, 0);
    add(window.twitchPlayer, 0);
    if (window.videojs?.getPlayers) Object.values(window.videojs.getPlayers()).forEach((p) => add(p, 0));
    for (let node of Array.from(document.querySelectorAll('video, .video-player, [data-a-target="video-player"]')).slice(0, 8)) {
      for (let n = 0; node && n < 12; n++, node = node.parentElement) {
        add(node.player, 0); add(node.player_, 0);
        for (const key of Object.keys(node)) if (/^__react(Fiber|InternalInstance|Props)/.test(key)) add(node[key], 0);
      }
    }
    const root = document.querySelector("#root");
    if (root) {
      add(root._reactRootContainer?._internalRoot?.current, 0);
      for (const key of Object.keys(root)) if (key.startsWith("__reactContainer")) add(root[key], 0);
    }
    for (let i = 0; i < queue.length && i < 500; i++) {
      const { value: p, depth } = queue[i];
      try {
        if ((typeof p.getQualities === "function" && typeof p.setQuality === "function") || typeof p.qualityLevels === "function") found.push(p);
        if (typeof p.getIVSPlayer === "function") add(p.getIVSPlayer(), depth + 1);
        if (depth >= 12) continue;
        for (const key of ["player", "playerInstance", "mediaPlayerInstance", "mediaPlayer", "core", "ivsPlayer", "videoPlayer", "current", "ref", "refs", "props", "memoizedProps", "memoizedState", "stateNode", "state", "next", "return", "child", "sibling"]) add(p[key], depth + 1);
        if (Object.getPrototypeOf(p) === Object.prototype && Object.keys(p).length <= 24) Object.values(p).forEach((value) => add(value, depth + 1));
      } catch { /* Players can dispose while their framework is updating. */ }
    }
    return found;
  }

  function adapter() {
    const youtube = document.getElementById("movie_player");
    if (youtube?.getAvailableQualityLevels && youtube?.setPlaybackQuality) {
      const names = { highres: "2160p+", hd2160: "2160p", hd1440: "1440p", hd1080: "1080p", hd720: "720p", large: "480p", medium: "360p", small: "240p", tiny: "144p" };
      const levels = youtube.getAvailableQualityLevels().filter((id) => id !== "auto");
      if (levels.length) return {
        options: [{ id: "auto", label: "auto" }, ...levels.map((id) => ({ id, label: names[id] || id }))],
        current: requested || youtube.getPlaybackQuality?.() || "auto",
        confirm: (id) => id === "auto" || youtube.getPlaybackQuality?.() === id,
        set: (id) => {
          if (id !== "auto" && youtube.setPlaybackQualityRange) youtube.setPlaybackQualityRange(id, id);
          else if (youtube.setPlaybackQualityRange) youtube.setPlaybackQualityRange("auto", "highres");
          youtube.setPlaybackQuality(id);
        },
      };
    }
    for (const p of playerObjects()) {
      const api = typeof p.getQualities === "function";
      const levels = Array.from(api ? p.getQualities() || [] : p.qualityLevels() || []);
      if (!levels.length) continue;
      const key = (q, i) => typeof q === "string" ? q : String(q.group || q.name || q.id || `level-${i}`);
      const options = levels.map((q, i) => {
        const fps = Number(q.framerate || q.frameRate || q.fps || 0);
        const id = key(q, i);
        return { id, label: q.height ? `${q.height}p${fps > 30 ? Math.round(fps) : ""}` : id };
      }).filter((q) => /^[a-zA-Z0-9_:.-]{1,80}$/.test(q.id));
      const current = p.getQuality?.();
      return {
        options: [{ id: "auto", label: "auto" }, ...options],
        current: p.isAutoQualityMode?.() ? "auto" : (typeof current === "string" ? current : current ? key(current, levels.indexOf(current)) : "auto"),
        confirm: api ? (id) => {
          if (id === "auto") return !p.isAutoQualityMode || p.isAutoQualityMode();
          const actual = p.getQuality?.();
          return (typeof actual === "string" ? actual : actual ? key(actual, levels.indexOf(actual)) : null) === id;
        } : undefined,
        set: async (id) => {
          const picked = levels.find((q, i) => key(q, i) === id);
          if (api) {
            if (p.setAutoQualityMode) await p.setAutoQualityMode(id === "auto");
            if (id !== "auto" || !p.setAutoQualityMode) {
              const twitch = /(^|\.)twitch\.tv$/.test(location.hostname);
              // Twitch's core uses rendition groups; its IVS player uses rendition objects.
              const rendition = typeof picked === "string" ? picked : twitch && picked?.group ? picked.group : picked;
              const result = await p.setQuality(id === "auto" ? "auto" : rendition, true);
              if (result === false) throw new Error("quality rejected");
            }
          } else for (const q of levels) q.enabled = id === "auto" || q === picked;
        },
      };
    }
    return null;
  }

  function poll() {
    try { const player = adapter(); if (player) { ownsPlayer = true; report({ options: player.options.slice(0, 32), current: player.current }); } } catch { /* Not ready yet. */ }
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.type === "MULTISTREAM_QUALITY_STATE" && event.source !== window) {
      report(data.report);
      return;
    }
    if (data?.type !== "MULTISTREAM_QUALITY_REQUEST" || !/^[a-zA-Z0-9_:.-]{1,80}$/.test(data.quality)) return;
    document.querySelectorAll("iframe").forEach((frame) => frame.contentWindow?.postMessage(data, "*"));
    if (isTop) window.dispatchEvent(new CustomEvent("multistream-quality-request", { detail: data.quality }));
    if (isTop && document.querySelector("[data-native-hls-player]")) return;
    const request = ++serial;
    const started = Date.now();
    const attempt = async () => {
      if (request !== serial) return;
      try {
        const player = adapter();
        if (player?.options.some((option) => option.id === data.quality)) {
          ownsPlayer = true;
          await player.set(data.quality);
          if (player.confirm) {
            const deadline = Date.now() + 5000;
            while (request === serial && !player.confirm(data.quality) && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            if (request !== serial) return;
            if (!player.confirm(data.quality)) {
              report({ options: player.options.slice(0, 32), current: player.current, failed: true });
              return;
            }
          }
          requested = data.quality;
          report({ options: player.options.slice(0, 32), current: data.quality });
          return;
        }
      } catch { /* Retry while the provider changes its current player. */ }
      if (Date.now() - started < 4000) setTimeout(attempt, 200);
      else if (ownsPlayer) {
        const player = adapter();
        report({ options: player?.options.slice(0, 32) || [], current: player?.current || "auto", failed: true });
      }
    };
    void attempt();
  });
  setInterval(poll, 1500);
  document.addEventListener("playing", poll, true);
})();
