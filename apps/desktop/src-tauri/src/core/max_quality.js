// Keep a site's own player on its highest quality.
//
// Some live sites (CamSoda) play adaptive HLS and drop to a lower rendition on their own, while
// their quality menu still names the high one; picking a low quality and then the high one again
// is the only way back. On those sites the master playlist is trimmed as it arrives, to the single
// highest variant (largest picture, then highest bitrate), so the player has nothing lower to
// switch to. Only master playlists (with #EXT-X-STREAM-INF) are touched; media playlists and
// segments pass through unchanged, and other sites are never affected.
(function () {
  if (window.__msMaxQuality) return;
  var HOSTS = /(^|\.)camsoda\.com$/i;
  if (!HOSTS.test(location.hostname)) return;
  window.__msMaxQuality = true;

  var isPlaylistUrl = function (url) {
    return /\.m3u8?(\?|#|$)/i.test(String(url || ""));
  };

  /** The playlist with only its best variant, or the text unchanged when there is nothing to trim. */
  var keepHighest = function (text) {
    if (typeof text !== "string" || text.indexOf("#EXT-X-STREAM-INF") < 0) return text;
    var lines = text.split(/\r?\n/);
    var variants = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      var uri = i + 1;
      while (uri < lines.length && (lines[uri].trim() === "" || lines[uri].charAt(0) === "#")) uri++;
      if (uri >= lines.length) continue;
      var resolution = /RESOLUTION=(\d+)x(\d+)/i.exec(lines[i]);
      var bandwidth = /(?:^|[:,])BANDWIDTH=(\d+)/i.exec(lines[i]);
      variants.push({
        start: i,
        end: uri,
        pixels: resolution ? Number(resolution[1]) * Number(resolution[2]) : 0,
        bandwidth: bandwidth ? Number(bandwidth[1]) : 0,
      });
    }
    if (variants.length < 2) return text;
    var best = variants[0];
    for (var j = 1; j < variants.length; j++) {
      var v = variants[j];
      if (v.pixels > best.pixels || (v.pixels === best.pixels && v.bandwidth > best.bandwidth))
        best = v;
    }
    var drop = {};
    for (var k = 0; k < variants.length; k++) {
      if (variants[k] === best) continue;
      for (var line = variants[k].start; line <= variants[k].end; line++) drop[line] = true;
    }
    return lines
      .filter(function (_, index) {
        return !drop[index];
      })
      .join("\n");
  };
  window.__msKeepHighest = keepHighest;

  // ---- XMLHttpRequest (hls.js and most players) --------------------------------------------
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var open = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      try {
        this.__msPlaylist = isPlaylistUrl(url);
      } catch (e) {}
      return open.apply(this, arguments);
    };
    var wrap = function (name) {
      var desc = Object.getOwnPropertyDescriptor(XHR.prototype, name);
      if (!desc || !desc.get) return;
      Object.defineProperty(XHR.prototype, name, {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () {
          var value = desc.get.call(this);
          if (!this.__msPlaylist || typeof value !== "string" || this.readyState !== 4) return value;
          if (this.__msRaw !== value) {
            this.__msRaw = value;
            this.__msTrimmed = keepHighest(value);
          }
          return this.__msTrimmed;
        },
      });
    };
    wrap("responseText");
    wrap("response");
  }

  // ---- fetch ------------------------------------------------------------------------------
  var originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      var pending = originalFetch.apply(this, arguments);
      if (!isPlaylistUrl(url)) return pending;
      return pending.then(function (response) {
        if (!response || !response.ok) return response;
        return response
          .clone()
          .text()
          .then(function (text) {
            var trimmed = keepHighest(text);
            if (trimmed === text) return response;
            return new Response(trimmed, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          })
          .catch(function () {
            return response;
          });
      });
    };
  }
})();
