(() => {
  let volume = null;
  const apply = () => {
    if (volume === null || window.__isGraveyard) return;
    document.querySelectorAll('video,audio').forEach((media) => {
      if (media.volume !== volume) media.volume = volume;
    });
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent && event.source !== window) return;
    if (event.data?.type !== 'MULTISTREAM_MIXER_VOLUME') return;
    const value = event.data.volume;
    if (!Number.isFinite(value) || value <= 0 || value > 1) return;
    volume = value;
    apply();
    for (const frame of document.querySelectorAll('iframe')) {
      frame.contentWindow?.postMessage({ type: 'MULTISTREAM_MIXER_VOLUME', volume }, '*');
    }
  });
  document.addEventListener('play', apply, true);
})();
