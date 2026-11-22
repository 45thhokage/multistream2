// Fit the page's main video to the website tile.
//
// Same approach as Multiview's fitVideo: every element from the video up to <body> is pinned to
// the whole tile, and everything beside the player (and beside each of its ancestors) is hidden.
// Pinning only the player is not enough: a site's own `#player { width: …px !important }` rules
// (or a wrapper that is the containing block of fixed children) then leave the video stuck in
// the top-left corner at its old size.
//
// The page is only touched by additions, all removed again on exit:
//   * one attribute on <html>                 (data-ms-fit)
//   * marker attributes on the chain/siblings (data-ms-fit-chain / -inner / -hide / -video)
//   * one constructed stylesheet              (adopted, so a page's CSP cannot block it)
// Inline styles and the page's own markup are never rewritten.
(function () {
  if (window !== window.top || window.__msFit) return;
  var channel = window.chrome && window.chrome.webview;

  var ATTR = "data-ms-fit";
  var CHAIN = "data-ms-fit-chain"; // the player and everything above it: pinned to the tile
  var INNER = "data-ms-fit-inner"; // wrappers between the player and the video: fill the player
  var HIDE = "data-ms-fit-hide"; // page around the player: hidden, never removed
  var VIDEO = "data-ms-fit-video";
  var BUTTON_MIN_W = 50;
  var BUTTON_MIN_H = 30;
  var AUTO_MIN_W = 200;
  var AUTO_MIN_H = 110;
  var FILLED = 0.92;
  var GESTURE_MS = 1200;
  var NO_AUTO_HOSTS = /(^|\.)(tiktok|instagram)\.com$/i;

  var post = function (state) {
    if (!channel) return;
    try {
      channel.postMessage(JSON.stringify({ __ms: 1, t: "fit", state: state }));
    } catch (e) {}
  };

  // Specificity is raised on purpose (two :not(#id) terms count as two ids): a site's own player
  // rules are often id-based and !important, and a fit that loses to them is a video that sits at
  // its old size in the corner of the tile. The marker attributes only exist while fitted, so the
  // rules need no `html[data-ms-fit]` prefix — which also lets the same sheet work in shadow roots.
  var UP = ":not(#ms-fit-a):not(#ms-fit-b)";
  var RESET =
    "transform: none !important; translate: none !important; scale: none !important; rotate: none !important; filter: none !important; backdrop-filter: none !important; perspective: none !important; contain: none !important; container-type: normal !important; content-visibility: visible !important; will-change: auto !important; clip-path: none !important; mask: none !important; aspect-ratio: auto !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; opacity: 1 !important; visibility: visible !important;";
  var CSS = [
    "html[" + ATTR + "], html[" + ATTR + "] body { overflow: hidden !important; background: #000 !important; }",
    "[" + HIDE + "]" + UP + " { display: none !important; }",
    "[" + CHAIN + "]" + UP + " { display: block !important; position: fixed !important; inset: 0 !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483000 !important; background: #000 !important; " + RESET + " }",
    "[" + INNER + "]" + UP + " { display: block !important; position: absolute !important; inset: 0 !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100% !important; height: 100% !important; " + RESET + " }",
    "video[" + VIDEO + "]" + UP + " { object-fit: contain !important; object-position: center !important; background: #000 !important; }",
    // The exit chip is a pseudo-element, so no node is added to the page.
    "html[" + ATTR + "]::after { content: 'Exit fit \\00B7  Esc'; position: fixed; top: 10px; right: 10px; z-index: 2147483647; box-sizing: border-box; padding: 4px 12px; font: 600 12px/18px system-ui, sans-serif; color: #fff; background: rgba(0, 0, 0, 0.7); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 999px; cursor: pointer; opacity: 0.6; pointer-events: auto; }",
    "html[" + ATTR + "]:hover::after { opacity: 1; }",
  ].join("\n");

  var active = null; // { video, marks, roots, sheet, url }
  var dismissed = typeof WeakSet === "function" ? new WeakSet() : null;
  var gesture = { at: 0, videos: [] };
  var watchTimer = 0;

  // The parent, stepping out of a shadow root to its host.
  var parentOf = function (node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    try {
      var root = node.getRootNode && node.getRootNode();
      return root && root.host ? root.host : null;
    } catch (e) {
      return null;
    }
  };

  var rectOf = function (node) {
    try {
      return node.getBoundingClientRect();
    } catch (e) {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    }
  };

  // A laid-out, visible video (it may be scrolled out of view).
  var sized = function (video) {
    var rect = rectOf(video);
    if (rect.width < 2 || rect.height < 2) return null;
    var style = getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden") return null;
    return rect;
  };

  // A video that is on screen right now.
  var shown = function (video) {
    var rect = sized(video);
    if (!rect) return null;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth)
      return null;
    return rect;
  };

  // Every <video>, including those inside open shadow roots.
  var allVideos = function () {
    var found = Array.prototype.slice.call(document.querySelectorAll("video"));
    if (found.length) return found;
    var walk = function (root) {
      var all = root.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        var sr = all[i].shadowRoot;
        if (!sr) continue;
        found = found.concat(Array.prototype.slice.call(sr.querySelectorAll("video")));
        walk(sr);
      }
    };
    try {
      walk(document);
    } catch (e) {}
    return found;
  };

  // The video the viewer most likely means: a playing one first, then the biggest.
  var bestVideo = function (minW, minH) {
    var best = null;
    var videos = allVideos();
    for (var i = 0; i < videos.length; i++) {
      var rect = sized(videos[i]);
      if (!rect || rect.width < minW || rect.height < minH) continue;
      var score = (videos[i].paused ? 0 : 1e9) + rect.width * rect.height;
      if (!best || score > best.score) best = { video: videos[i], score: score };
    }
    return best && best.video;
  };

  // The player: the video's highest ancestor that is still about the video's own size. Its
  // controls and overlays live inside it, so it is kept whole; everything beside it is page.
  var playerOf = function (video) {
    var vr = rectOf(video);
    var player = video;
    var node = parentOf(video);
    while (node && node !== document.body && node !== document.documentElement) {
      var r = rectOf(node);
      if (r.width > vr.width * 1.15 + 2 || r.height > vr.height * 1.15 + 2) break;
      player = node;
      node = parentOf(node);
    }
    return player;
  };

  var mark = function (state, node, name) {
    if (node.hasAttribute(name)) return;
    node.setAttribute(name, "");
    state.marks.push({ node: node, name: name });
  };

  var adopt = function (state, root) {
    if (state.roots.indexOf(root) >= 0) return;
    try {
      root.adoptedStyleSheets = root.adoptedStyleSheets.concat([state.sheet]);
      state.roots.push(root);
    } catch (e) {}
  };

  var exit = function (byUser) {
    if (!active) return;
    var state = active;
    active = null;
    clearInterval(watchTimer);
    for (var i = 0; i < state.marks.length; i++) {
      try {
        state.marks[i].node.removeAttribute(state.marks[i].name);
      } catch (e) {}
    }
    document.documentElement.removeAttribute(ATTR);
    for (var j = 0; j < state.roots.length; j++) {
      try {
        state.roots[j].adoptedStyleSheets = state.roots[j].adoptedStyleSheets.filter(
          function (sheet) {
            return sheet !== state.sheet;
          }
        );
      } catch (e) {}
    }
    if (byUser && dismissed) dismissed.add(state.video);
    post("off");
  };

  var enter = function (video) {
    if (active) return true;
    if (!video || !video.isConnected || typeof CSSStyleSheet !== "function") return false;
    var player = playerOf(video);

    // The chain from the video up to <body>; a video that never reaches it is not fittable.
    var chain = [];
    var node = video;
    var reachedBody = false;
    while (node) {
      if (node === document.body) {
        reachedBody = true;
        break;
      }
      if (node === document.documentElement) break;
      chain.push(node);
      node = parentOf(node);
    }
    if (!reachedBody) return false;

    var sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    var state = { video: video, marks: [], roots: [], sheet: sheet, url: location.href };
    adopt(state, document);

    var aboveOrAtPlayer = false;
    for (var i = 0; i < chain.length; i++) {
      var c = chain[i];
      if (c === player) aboveOrAtPlayer = true;
      mark(state, c, aboveOrAtPlayer ? CHAIN : INNER);
      var holder = c.parentNode;
      // The sheet must reach every shadow root the chain passes through.
      if (holder && holder.nodeType === 11 && holder.host) adopt(state, holder);
      if (!aboveOrAtPlayer) continue;
      // Beside the player and above it is page: hidden, not removed.
      var kids = holder && holder.children ? holder.children : [];
      for (var k = 0; k < kids.length; k++) {
        var s = kids[k];
        if (s === c) continue;
        var tag = String(s.tagName || "").toLowerCase();
        if (
          tag === "script" ||
          tag === "style" ||
          tag === "link" ||
          tag === "meta" ||
          tag === "template"
        )
          continue;
        mark(state, s, HIDE);
      }
    }
    mark(state, video, VIDEO);
    document.documentElement.setAttribute(ATTR, "1");
    active = state;
    // Leave on its own if the page replaces the video, moves to another page, or the viewer goes
    // fullscreen: a fitted tile must never be stranded on a page that is not the video.
    watchTimer = setInterval(function () {
      if (!active) return;
      if (
        !active.video.isConnected ||
        !sized(active.video) ||
        location.href !== active.url ||
        document.fullscreenElement
      )
        exit(false);
    }, 500);
    post("on");
    return true;
  };

  var toggle = function () {
    if (active) {
      exit(true);
      return;
    }
    var video = bestVideo(BUTTON_MIN_W, BUTTON_MIN_H);
    if (!video || !enter(video)) post("none");
  };

  // ---- automatic fit when the viewer presses play inside the video ---------------------------
  var autoAllowed = function () {
    return window.__MS_FIT_AUTO !== false && !NO_AUTO_HOSTS.test(location.hostname);
  };

  var noteGesture = function (event) {
    if (!event.isTrusted) return;
    var videos = [];
    var list = document.querySelectorAll("video");
    if (event.type === "pointerdown") {
      for (var i = 0; i < list.length; i++) {
        var rect = shown(list[i]);
        if (
          rect &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        )
          videos.push(list[i]);
      }
    } else if (event.key === " " || event.key === "k" || event.key === "K" || event.key === "Enter") {
      var focused = document.activeElement;
      for (var j = 0; j < list.length; j++) {
        if (
          focused &&
          focused !== document.body &&
          focused !== document.documentElement &&
          (list[j].contains(focused) || focused.contains(list[j]))
        )
          videos.push(list[j]);
      }
    } else {
      return;
    }
    gesture = { at: performance.now(), videos: videos };
  };

  var onPlay = function (event) {
    var video = event.target;
    if (!(video instanceof HTMLVideoElement) || active || !autoAllowed()) return;
    if (dismissed && dismissed.has(video)) return;
    if (document.fullscreenElement) return;
    // Autoplay and thumbnail clicks are not a press on this video's own play control.
    if (performance.now() - gesture.at > GESTURE_MS || gesture.videos.indexOf(video) < 0) return;
    // Vertical video is not fitted: the page's own layout is the better frame.
    if (video.videoWidth && video.videoHeight && video.videoHeight > video.videoWidth) return;
    var rect = shown(video);
    if (!rect || rect.width < AUTO_MIN_W || rect.height < AUTO_MIN_H) return;
    if (rect.width * rect.height >= FILLED * innerWidth * innerHeight) return;
    enter(video);
  };

  window.addEventListener("pointerdown", noteGesture, true);
  window.addEventListener("keydown", noteGesture, true);
  document.addEventListener("play", onPlay, true);

  window.addEventListener(
    "keydown",
    function (event) {
      if (!active || event.key !== "Escape" || document.fullscreenElement) return;
      event.preventDefault();
      event.stopPropagation();
      exit(true);
    },
    true
  );
  // The exit chip is a pseudo-element of <html>; the fixed player covers the rest of the page,
  // so a click that lands on <html> itself is a click on the chip.
  window.addEventListener(
    "click",
    function (event) {
      if (active && event.target === document.documentElement) {
        event.preventDefault();
        event.stopPropagation();
        exit(true);
      }
    },
    true
  );

  window.__msFit = {
    toggle: toggle,
    exit: function () {
      exit(true);
    },
    isActive: function () {
      return !!active;
    },
  };
})();
