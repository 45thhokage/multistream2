(function () {
  // only run inside iframes, not the main app frame
  if (window === window.top) return;

  // Forward clicks/hover (audio focus) and edge proximity (immersive panels) to the app.
  // Only Escape is forwarded; other key presses stay with the embedded page.
  window.addEventListener("pointerdown", function () {
    window.parent.postMessage({ type: "NATIVE_INTERACTION", kind: "click" }, "*");
  }, true);
  window.addEventListener("pointerover", function () {
    window.parent.postMessage({ type: "NATIVE_INTERACTION", kind: "hover" }, "*");
  }, true);

  // Escape leaves fullscreen even while an embedded player has keyboard focus. Players are often
  // nested (an embed inside an embed) and intermediate frames do not relay it, so post straight
  // to the top frame (the tile's player page, or the app window in non-native mode).
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") window.top.postMessage({ type: "NATIVE_ESCAPE" }, "*");
  }, true);

  window.addEventListener("mousemove", function (e) {
    var side = e.clientX < 14 ? "left" : e.clientX > window.innerWidth - 14 ? "right" : null;
    if (side) window.parent.postMessage({ type: "NATIVE_EDGE", side: side }, "*");
  });
})();
