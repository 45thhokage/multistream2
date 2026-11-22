// Experimental direct HLS playback for website tiles.
// The app enables it per tile with window.__msSiteHls.enable({ sniffed }) after
// injecting hls.js as window.__msHls. The room's playlist is taken from:
//   1. playlists the app saw this page request (passed in as `sniffed`),
//   2. this page's own resource timing entries,
//   3. a per-site room API (live-room sites below),
//   4. playlist URLs embedded in the page markup.
// Playback is an overlay <video> inside this page, so every request keeps the
// site's own origin and session. Disabling removes the overlay.
(function () {
  if (window !== window.top || window.__msSiteHls) return;
  var channel = window.chrome && window.chrome.webview;

  var post = function (message) {
    if (!channel) return;
    try {
      message.__ms = 1;
      message.t = "hls";
      channel.postMessage(JSON.stringify(message));
    } catch (e) {}
  };

  var RESERVED =
    /^(tags?|female|male|couples?|trans|search|login|signin|signup|register|accounts?|affiliates?|terms|privacy|support|auth|api|categories|category|girls|guys|explore|discover|new|popular|top|favorites|followed-cams|following|external_link|apps|contest|tipping|tube|security|dmca|law_enforcement|2257|billing|settings|profile|help|faq|blog|models?|studio|p|en|de|fr|es|it|ru|ja|pt|nl|pl)$/i;

  var isPlaylist = function (url) {
    return typeof url === "string" && /\.m3u8(\?|#|$)/i.test(url);
  };
  var absolute = function (url) {
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return null;
    }
  };
  var firstSegment = function () {
    return decodeURIComponent(location.pathname.split("/").find(Boolean) || "");
  };
  var roomName = function () {
    var name = firstSegment();
    return name && !RESERVED.test(name) && /^[A-Za-z0-9_.-]{2,64}$/.test(name) ? name : "";
  };
  var hostIs = function (domain) {
    var host = location.hostname.toLowerCase();
    return host === domain || host.endsWith("." + domain);
  };
  var getJson = async function (url, init) {
    var response = await fetch(
      url,
      Object.assign(
        {
          credentials: "include",
          headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
        },
        init || {}
      )
    );
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  };
  var parseMaybe = function (value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  };

  // Room adapters: each returns a playlist URL for the room on screen, or null.
  var adapters = [
    {
      name: "chaturbate",
      hosts: ["chaturbate.com"],
      find: async function () {
        var room = roomName();
        if (!room) return null;
        var dossier = parseMaybe(window.initialRoomDossier);
        if (dossier && dossier.hls_source) return dossier.hls_source;
        var data = await getJson("/api/chatvideocontext/" + encodeURIComponent(room) + "/");
        return (data && data.hls_source) || null;
      },
    },
    {
      name: "stripchat",
      hosts: ["stripchat.com", "xhamsterlive.com"],
      find: async function () {
        var user = roomName();
        if (!user) return null;
        var state = window.__PRELOADED_STATE__ || {};
        var view = state.viewCam || {};
        var id = view.model && view.model.id;
        var config = (state.config && state.config.data) || {};
        var hosts = [];
        if (config.hlsStreamHost) hosts.push(config.hlsStreamHost);
        var fallback =
          config.featuresV2 &&
          config.featuresV2.hlsFallback &&
          config.featuresV2.hlsFallback.fallbackDomains;
        if (Array.isArray(fallback)) hosts = hosts.concat(fallback);
        if (!id) {
          var cam = await getJson(
            "/api/front/v2/models/username/" + encodeURIComponent(user) + "/cam"
          );
          id = cam && cam.user && cam.user.user && cam.user.user.id;
        }
        if (!id) return null;
        var host = hosts[0] || "doppiocdn.com";
        return "https://edge-hls." + host + "/hls/" + id + "/master/" + id + "_auto.m3u8";
      },
    },
    {
      name: "cam4",
      hosts: ["cam4.com"],
      find: async function () {
        var user = roomName();
        if (!user) return null;
        var data = await getJson(
          "/rest/v1.0/profile/" + encodeURIComponent(user) + "/streamInfo"
        );
        return (data && (data.cdnURL || data.cdnUrl)) || null;
      },
    },
    {
      name: "camsoda",
      hosts: ["camsoda.com"],
      find: async function () {
        var user = roomName();
        if (!user) return null;
        var data = await getJson("/api/v1/chat/react/" + encodeURIComponent(user));
        var stream = data && data.stream;
        if (!stream) return null;
        if (isPlaylist(stream.stream_url)) return stream.stream_url;
        var edge = stream.edge_servers && stream.edge_servers[0];
        if (!edge || !stream.stream_name) return null;
        return (
          "https://" +
          edge +
          "/" +
          stream.stream_name +
          "_v1/index.m3u8" +
          (stream.token ? "?token=" + encodeURIComponent(stream.token) : "")
        );
      },
    },
    {
      name: "bongacams",
      hosts: ["bongacams.com", "bongacams.net", "bongacams2.com", "bongacams10.com", "bongacams11.com"],
      find: async function () {
        var user = roomName();
        if (!user) return null;
        var body = new URLSearchParams();
        body.set("method", "getRoomData");
        body.append("args[]", user);
        var response = await fetch("/tools/amf.php?res=" + Date.now(), {
          method: "POST",
          credentials: "include",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body,
        });
        if (!response.ok) return null;
        var data = await response.json();
        var server = data && data.localData && data.localData.videoServerUrl;
        var name = data && data.performerData && data.performerData.username;
        if (!server || !name) return null;
        var base = server.indexOf("//") === 0 ? "https:" + server : server;
        return base + "/hls/stream_" + name + "/playlist.m3u8";
      },
    },
    {
      name: "cammodels",
      hosts: ["cammodels.com"],
      find: async function () {
        var parts = location.pathname.split("/").filter(Boolean);
        if (parts[0] !== "cam" || !parts[1]) return null;
        var data = await getJson(
          "https://manifest-server.naiadsystems.com/live/s:" + encodeURIComponent(parts[1]) + ".json",
          { credentials: "omit", headers: { Accept: "application/json" } }
        );
        var format = data && data.formats && data.formats["mp4-hls"];
        var encodings = (format && format.encodings) || [];
        if (!encodings.length) return null;
        encodings.sort(function (a, b) {
          return (b.videoHeight || 0) - (a.videoHeight || 0);
        });
        return encodings[0].location || null;
      },
    },
  ];

  var fromPerformance = function () {
    try {
      return performance
        .getEntriesByType("resource")
        .map(function (entry) {
          return entry.name;
        })
        .filter(isPlaylist)
        .toReversed();
    } catch (e) {
      return [];
    }
  };

  var fromMarkup = function () {
    try {
      var html = document.documentElement.innerHTML
        .replace(/\\u002[fF]/g, "/")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&");
      var found = html.match(/https?:\/\/[^"'\s<>\\]+?\.m3u8[^"'\s<>\\]*/gi) || [];
      return found;
    } catch (e) {
      return [];
    }
  };

  var state = {
    enabled: false,
    path: "",
    hls: null,
    overlay: null,
    video: null,
    select: null,
    url: null,
    source: null,
    failed: new Set(),
    recoveries: 0,
    reextracts: 0,
    searchTimer: null,
    pauseTimer: null,
    searches: 0,
    preference: "max",
    paused: [],
  };

  var report = function (status, extra) {
    post(
      Object.assign(
        {
          state: status,
          url: state.url,
          source: state.source,
          level: currentLevelLabel(),
        },
        extra || {}
      )
    );
  };

  var levelLabel = function (level) {
    if (!level) return "";
    var parts = [];
    if (level.height) parts.push(level.height + "p");
    var fps = level.frameRate || (level.attrs && parseFloat(level.attrs["FRAME-RATE"]));
    if (fps && fps > 30) parts[0] = (parts[0] || "") + Math.round(fps);
    if (level.bitrate) parts.push((level.bitrate / 1e6).toFixed(1) + " Mbps");
    return parts.join(" · ") || "source";
  };

  var currentLevelLabel = function () {
    var hls = state.hls;
    if (!hls || !hls.levels || hls.currentLevel < 0) return state.preference;
    return levelLabel(hls.levels[hls.currentLevel]);
  };

  var bestLevel = function (levels) {
    var best = -1;
    for (var i = 0; i < levels.length; i++) {
      if (best < 0) {
        best = i;
        continue;
      }
      var a = levels[i];
      var b = levels[best];
      var key = function (l) {
        return [l.height || 0, l.frameRate || 0, l.bitrate || 0];
      };
      var ka = key(a);
      var kb = key(b);
      for (var k = 0; k < 3; k++) {
        if (ka[k] !== kb[k]) {
          if (ka[k] > kb[k]) best = i;
          break;
        }
      }
    }
    return best;
  };

  var applyPreference = function () {
    var hls = state.hls;
    if (!hls || !hls.levels || !hls.levels.length) return;
    if (state.preference === "auto") {
      hls.currentLevel = -1;
    } else if (state.preference === "max") {
      hls.currentLevel = bestLevel(hls.levels);
    } else {
      var index = parseInt(state.preference, 10);
      hls.currentLevel = index >= 0 && index < hls.levels.length ? index : -1;
    }
  };

  var fillQuality = function () {
    var select = state.select;
    var hls = state.hls;
    if (!select) return;
    select.innerHTML = "";
    var add = function (value, label) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    };
    add("max", "Max");
    add("auto", "Auto");
    if (hls && hls.levels) {
      hls.levels
        .map(function (level, index) {
          return { level: level, index: index };
        })
        .toSorted(function (a, b) {
          return (b.level.height || 0) - (a.level.height || 0) || (b.level.bitrate || 0) - (a.level.bitrate || 0);
        })
        .forEach(function (item) {
          add(String(item.index), levelLabel(item.level));
        });
    }
    select.value = state.preference;
    select.style.display = hls && hls.levels && hls.levels.length > 1 ? "" : "none";
  };

  var pauseSitePlayers = function () {
    var videos = document.querySelectorAll("video, audio");
    for (var i = 0; i < videos.length; i++) {
      var media = videos[i];
      if (media === state.video) continue;
      try {
        if (!media.paused) {
          media.pause();
          if (state.paused.indexOf(media) < 0) state.paused.push(media);
        }
        media.muted = true;
      } catch (e) {}
    }
  };

  var buildOverlay = function () {
    if (state.overlay && state.overlay.isConnected) return;
    var overlay = document.createElement("div");
    overlay.setAttribute("data-multistream", "site-hls");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:#000;display:flex;align-items:center;justify-content:center;";
    var video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;";
    var badge = document.createElement("div");
    badge.textContent = "Direct HLS";
    badge.style.cssText =
      "position:absolute;top:8px;left:8px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.6);color:#c7d2fe;font:600 11px system-ui,sans-serif;pointer-events:none;";
    var select = document.createElement("select");
    select.setAttribute("aria-label", "Quality");
    select.style.cssText =
      "position:absolute;top:8px;right:8px;padding:3px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(20,22,26,.85);color:#eaeaea;font:12px system-ui,sans-serif;";
    select.addEventListener("change", function () {
      state.preference = select.value;
      applyPreference();
      report("playing");
    });
    overlay.appendChild(video);
    overlay.appendChild(badge);
    overlay.appendChild(select);
    (document.body || document.documentElement).appendChild(overlay);
    state.overlay = overlay;
    state.video = video;
    state.select = select;
  };

  var destroyPlayer = function () {
    if (state.hls) {
      try {
        state.hls.destroy();
      } catch (e) {}
    }
    state.hls = null;
    if (state.video) {
      try {
        state.video.removeAttribute("src");
        state.video.load();
      } catch (e) {}
    }
  };

  var removeOverlay = function () {
    destroyPlayer();
    if (state.overlay) state.overlay.remove();
    state.overlay = null;
    state.video = null;
    state.select = null;
  };

  var stopTimers = function () {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    if (state.pauseTimer) clearInterval(state.pauseTimer);
    state.searchTimer = null;
    state.pauseTimer = null;
  };

  var looksLikePlaylist = async function (url) {
    try {
      var response = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (!response.ok) return false;
      var text = await response.text();
      return text.indexOf("#EXTM3U") >= 0;
    } catch (e) {
      // Some CDNs only answer the player's own request shape; let hls.js try.
      return true;
    }
  };

  var play = function (url, source) {
    buildOverlay();
    destroyPlayer();
    state.url = url;
    state.source = source;
    state.recoveries = 0;
    pauseSitePlayers();
    if (!state.pauseTimer) state.pauseTimer = setInterval(pauseSitePlayers, 2000);
    var video = state.video;
    var Hls = window.__msHls;
    if (!Hls || !Hls.isSupported()) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.play().catch(function () {});
        report("playing");
        return;
      }
      fail("This page cannot run the HLS player");
      return;
    }
    var hls = new Hls({
      enableWorker: false,
      lowLatencyMode: true,
      capLevelToPlayerSize: false,
      startLevel: -1,
      maxBufferLength: 20,
      backBufferLength: 30,
    });
    state.hls = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      fillQuality();
      applyPreference();
      video.play().catch(function () {
        video.muted = true;
        video.play().catch(function () {});
      });
      report("playing");
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, function () {
      report("playing");
    });
    hls.on(Hls.Events.ERROR, function (_event, data) {
      if (!data || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && state.recoveries < 3) {
        state.recoveries++;
        hls.recoverMediaError();
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && state.recoveries < 3) {
        state.recoveries++;
        setTimeout(function () {
          if (state.hls === hls) hls.startLoad();
        }, 1500 * state.recoveries);
        return;
      }
      state.failed.add(url);
      reextract("Playback failed: " + (data.details || data.type));
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    report("loading");
  };

  var fail = function (message) {
    stopTimers();
    removeOverlay();
    resumeSite();
    report("failed", { message: message });
  };

  var resumeSite = function () {
    var paused = state.paused;
    state.paused = [];
    for (var i = 0; i < paused.length; i++) {
      try {
        paused[i].muted = false;
        paused[i].play().catch(function () {});
      } catch (e) {}
    }
  };

  var reextract = function (message) {
    if (state.reextracts >= 3) {
      fail(message);
      return;
    }
    state.reextracts++;
    destroyPlayer();
    report("searching", { message: message });
    discover([]);
  };

  var adapterFor = function () {
    for (var i = 0; i < adapters.length; i++) {
      for (var j = 0; j < adapters[i].hosts.length; j++) {
        if (hostIs(adapters[i].hosts[j])) return adapters[i];
      }
    }
    return null;
  };

  var candidateFrom = function (list, source) {
    for (var i = 0; i < list.length; i++) {
      var url = absolute(list[i]);
      if (url && isPlaylist(url) && !state.failed.has(url)) return { url: url, source: source };
    }
    return null;
  };

  var discover = async function (sniffed) {
    if (!state.enabled) return;
    var candidate = candidateFrom(sniffed || [], "observed") || candidateFrom(fromPerformance(), "page");
    var adapter = adapterFor();
    if (!candidate && adapter) {
      try {
        var found = await adapter.find();
        if (found) candidate = candidateFrom([found], adapter.name);
      } catch (e) {}
    }
    if (!candidate) candidate = candidateFrom(fromMarkup(), "markup");
    if (!state.enabled) return;
    if (candidate && (await looksLikePlaylist(candidate.url))) {
      if (!state.enabled) return;
      play(candidate.url, candidate.source);
      return;
    }
    if (candidate) state.failed.add(candidate.url);
    state.searches++;
    if (state.searches > 8) {
      fail("No HLS stream found on this page");
      return;
    }
    report("searching");
    state.searchTimer = setTimeout(function () {
      discover([]);
    }, 4000);
  };

  window.__msSiteHls = {
    enable: function (options) {
      var path = location.pathname;
      if (state.enabled && state.path === path && (state.hls || state.searchTimer)) return;
      stopTimers();
      removeOverlay();
      state.enabled = true;
      state.path = path;
      state.failed = new Set();
      state.reextracts = 0;
      state.searches = 0;
      report("searching");
      discover((options && options.sniffed) || []);
    },
    offer: function (url) {
      if (!state.enabled || state.hls || !isPlaylist(url)) return;
      if (state.searchTimer) clearTimeout(state.searchTimer);
      state.searchTimer = null;
      discover([url]);
    },
    disable: function () {
      var wasOn = state.enabled;
      state.enabled = false;
      stopTimers();
      removeOverlay();
      resumeSite();
      if (wasOn) report("off");
    },
  };
})();
