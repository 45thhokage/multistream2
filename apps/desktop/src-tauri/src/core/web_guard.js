// Website-tile page bridge for cosmetic ad filtering.
// Reports the page URL and the CSS classes/ids it uses; the app answers with
// hide rules through window.__msGuard.apply(css). Top frame only: iframes have
// no chrome.webview channel.
(function () {
  if (window !== window.top || window.__msGuard) return;
  var channel = window.chrome && window.chrome.webview;
  if (!channel) return;

  var post = function (message) {
    try {
      message.__ms = 1;
      channel.postMessage(JSON.stringify(message));
    } catch (e) {}
  };

  var css = "";
  var style = null;
  var generic = true;
  var seenClasses = new Set();
  var seenIds = new Set();
  var pendingClasses = [];
  var pendingIds = [];
  var timer = null;

  var ensureStyle = function () {
    if (style && style.isConnected) return style;
    style = document.createElement("style");
    style.setAttribute("data-multistream", "adblock");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  };

  var flush = function () {
    timer = null;
    if (!generic) {
      pendingClasses = [];
      pendingIds = [];
      return;
    }
    if (!pendingClasses.length && !pendingIds.length) return;
    post({
      t: "classes",
      classes: pendingClasses.splice(0, 1500),
      ids: pendingIds.splice(0, 1500),
    });
    if (pendingClasses.length || pendingIds.length) timer = setTimeout(flush, 60);
  };

  var schedule = function () {
    if (!timer) timer = setTimeout(flush, 150);
  };

  var note = function (el) {
    if (!el || el.nodeType !== 1) return;
    var list = el.classList;
    if (list) {
      for (var i = 0; i < list.length; i++) {
        var name = list[i];
        if (name.length <= 80 && !seenClasses.has(name)) {
          seenClasses.add(name);
          pendingClasses.push(name);
        }
      }
    }
    var id = el.id;
    if (id && typeof id === "string" && id.length <= 80 && !seenIds.has(id)) {
      seenIds.add(id);
      pendingIds.push(id);
    }
  };

  var scan = function (root) {
    note(root);
    if (root.querySelectorAll) {
      var all = root.querySelectorAll("[class],[id]");
      for (var i = 0; i < all.length; i++) note(all[i]);
    }
    schedule();
  };

  window.__msGuard = {
    apply: function (text) {
      if (!text) return;
      css += text;
      ensureStyle().textContent = css;
    },
    setGeneric: function (value) {
      generic = !!value;
      if (generic) schedule();
    },
  };

  post({ t: "page", url: location.href });

  var start = function () {
    if (!document.documentElement) return;
    scan(document.documentElement);
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "attributes") note(m.target);
        else
          for (var j = 0; j < m.addedNodes.length; j++) {
            if (m.addedNodes[j].nodeType === 1) scan(m.addedNodes[j]);
          }
      }
      schedule();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id"],
    });
    // Keep the style element alive if a framework replaces <head>.
    document.addEventListener("DOMContentLoaded", function () {
      if (css) ensureStyle();
    });
  };
  if (document.documentElement) start();
  else document.addEventListener("readystatechange", start, { once: true });

  // Single-page apps change rooms without a navigation; report the new URL.
  var last = location.href;
  setInterval(function () {
    if (location.href !== last) {
      last = location.href;
      post({ t: "page", url: last, spa: true });
    }
  }, 1000);
})();
