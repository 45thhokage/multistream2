// Per-tile volume from the mixer, for pages whose audio the app cannot scale natively.
//
// The app posts the tile's volume every second. A page is touched as little as possible, because
// players such as TikTok's keep their own volume and play state and react to any `volumechange`:
//  * at 100% the page is left alone entirely (and any volume this script set is given back);
//  * below 100%, each media element gets the volume once, when it appears or the value changes,
//    never again on every tick or every `play`;
//  * a value the page sets itself afterwards is respected until the mixer value changes.
(() => {
  if (window.__msMixerInstalled) return;
  window.__msMixerInstalled = true;
  /** The mixer volume being applied, or null when the page keeps its own (100%). */
  let volume = null;
  /** Element -> { original volume, value this script last set }. */
  const touched = new WeakMap();
  const tracked = new Set();

  const applyTo = (media) => {
    if (volume === null || window.__isGraveyard) return;
    const seen = touched.get(media);
    if (seen && seen.set === volume) return;
    touched.set(media, { original: seen ? seen.original : media.volume, set: volume });
    tracked.add(media);
    if (media.volume !== volume) media.volume = volume;
  };
  const applyAll = () => document.querySelectorAll("video,audio").forEach(applyTo);
  const release = () => {
    for (const media of tracked) {
      const seen = touched.get(media);
      // Only undo what is still ours: a volume the page chose since then stays.
      if (seen && media.isConnected && media.volume === seen.set) media.volume = seen.original;
      touched.delete(media);
    }
    tracked.clear();
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent && event.source !== window) return;
    if (event.data?.type !== "MULTISTREAM_MIXER_VOLUME") return;
    const value = event.data.volume;
    if (!Number.isFinite(value) || value <= 0 || value > 1) return;
    const next = value >= 1 ? null : value;
    if (next !== volume) {
      volume = next;
      if (volume === null) release();
      else applyAll();
    }
    for (const frame of document.querySelectorAll("iframe")) {
      frame.contentWindow?.postMessage({ type: "MULTISTREAM_MIXER_VOLUME", volume: value }, "*");
    }
  });
  // New media elements (the next video in a feed) get the volume when they load, once.
  document.addEventListener("loadedmetadata", (event) => {
    const media = event.target;
    if (media instanceof HTMLMediaElement) applyTo(media);
  }, true);
})();
