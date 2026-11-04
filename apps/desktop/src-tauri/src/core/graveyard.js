(() => {
  window.addEventListener("message", (event) => {
    if (event.source !== window && event.source !== window.parent) return;
    if (event.data?.type !== "MULTISTREAM_GRAVEYARD_SUSPEND" || window.__isGraveyard) return;
    window.__isGraveyard = true;
    for (const frame of document.querySelectorAll("iframe")) {
      frame.contentWindow?.postMessage(event.data, "*");
    }
    const silence = () => document.querySelectorAll("video,audio").forEach((media) => {
      media.muted = true;
      media.volume = 0;
      media.pause();
      media.removeAttribute("autoplay");
    });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    silence();
    document.addEventListener("play", silence, true);
    if (document.documentElement) new MutationObserver(silence).observe(document.documentElement, { childList: true, subtree: true });
  });
})();
