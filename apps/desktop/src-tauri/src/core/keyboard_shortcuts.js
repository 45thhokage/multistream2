(function () {
  // only run inside iframes, not the main app frame
  if (window === window.top) return;

  window.addEventListener("pointerdown", function () {
    window.parent.postMessage({ type: "NATIVE_INTERACTION", kind: "click" }, "*");
  }, true);
  window.addEventListener("pointerover", function () {
    window.parent.postMessage({ type: "NATIVE_INTERACTION", kind: "hover" }, "*");
  }, true);

  window.addEventListener("mousemove", function (e) {
    var side = e.clientX < 14 ? "left" : e.clientX > window.innerWidth - 14 ? "right" : null;
    if (side) window.parent.postMessage({ type: "NATIVE_EDGE", side: side }, "*");
  });

  // intercept keydown events inside the iframe and forward to parent
  window.addEventListener("keydown", function (e) {
    if (
      document.activeElement &&
      (document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "TEXTAREA" ||
        document.activeElement.isContentEditable)
    )
      return;

    var key = e.key;
    // forward 1-9 (select chat), S (screenshot), D (add dialog), F11 (toggle immersive/fullscreen), Escape (exit immersive/fullscreen)
    if (
      (key >= "1" && key <= "9") ||
      key === "s" ||
      key === "S" ||
      key === "d" ||
      key === "D" ||
      key === "F11" ||
      key === "Escape"
    ) {
      window.parent.postMessage({ type: "SHORTCUT", key: key }, "*");

      e.preventDefault();
      e.stopPropagation();
    }
  });
})();
