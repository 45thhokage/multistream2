// Counts the bytes WebRTC connections receive, for the data-usage meter.
//
// WebRTC media and data channels travel over UDP, outside the DevTools `Network` domain the
// meter reads, so they are measured here from `RTCPeerConnection.getStats()`. Frames inside the
// page (embedded players) report to the top frame, which hands the total to the app once a
// second. Nothing about the connections themselves is changed.
(function () {
  if (window.__msRtcMeter) return;
  var Native = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (typeof Native !== "function") return;
  window.__msRtcMeter = true;

  var isTop = window === window.top;
  var channel = window.chrome && window.chrome.webview;
  var POLL_MS = 1000;
  var MAX_REPORT = 50 * 1024 * 1024; // a single report above this is not believable
  var pcs = [];
  var pending = 0;
  var pollTimer = 0;
  var flushTimer = 0;
  var viaIpc = null; // null = untried, true = app IPC works here, false = use the page bridge

  var sendToApp = function (bytes) {
    var bridge = function () {
      if (!channel) return;
      try {
        channel.postMessage(JSON.stringify({ __ms: 1, t: "rtc", bytes: bytes }));
      } catch (e) {}
    };
    var internals = window.__TAURI_INTERNALS__;
    if (viaIpc !== false && internals && typeof internals.invoke === "function") {
      try {
        internals.invoke("bandwidth_record_rtc", { bytes: bytes }).then(
          function () {
            viaIpc = true;
          },
          function () {
            // Website tiles are remote pages with no app IPC; they use the page bridge instead.
            if (viaIpc === null) viaIpc = false;
            bridge();
          }
        );
        return;
      } catch (e) {
        viaIpc = false;
      }
    }
    bridge();
  };

  var flush = function () {
    flushTimer = 0;
    if (pending <= 0) return;
    var bytes = Math.min(Math.round(pending), MAX_REPORT);
    pending = 0;
    if (isTop) sendToApp(bytes);
    else {
      try {
        window.top.postMessage({ __msRtc: bytes }, "*");
      } catch (e) {}
    }
  };
  var scheduleFlush = function () {
    if (!flushTimer) flushTimer = setTimeout(flush, POLL_MS);
  };

  // Frames report up through the top frame; the top frame also relays nested frames.
  if (isTop) {
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (event.source === window || !data || typeof data.__msRtc !== "number") return;
      if (!(data.__msRtc > 0) || data.__msRtc > MAX_REPORT) return;
      pending += data.__msRtc;
      scheduleFlush();
    });
  }

  // Bytes received on one connection: the ICE transport counts everything (media, data channels,
  // RTCP, DTLS). Older engines without transport stats fall back to the sum of the media streams.
  var receivedBytes = function (report) {
    var perId = {};
    var any = false;
    report.forEach(function (stat) {
      if (stat.type === "transport" && typeof stat.bytesReceived === "number") {
        perId["t:" + stat.id] = stat.bytesReceived;
        any = true;
      }
    });
    if (any) return perId;
    report.forEach(function (stat) {
      if (stat.type === "inbound-rtp" && typeof stat.bytesReceived === "number") {
        perId["r:" + stat.id] = stat.bytesReceived + (stat.headerBytesReceived || 0);
      } else if (stat.type === "data-channel" && typeof stat.bytesReceived === "number") {
        perId["d:" + stat.id] = stat.bytesReceived;
      }
    });
    return perId;
  };

  var poll = function () {
    for (var i = pcs.length - 1; i >= 0; i--) {
      (function (entry) {
        if (entry.busy) return;
        entry.busy = true;
        entry.pc.getStats().then(
          function (report) {
            entry.busy = false;
            var now = receivedBytes(report);
            for (var id in now) {
              var before = entry.last[id] || 0;
              // A counter that went backwards (ICE restart, new transport) starts over.
              pending += now[id] >= before ? now[id] - before : now[id];
              entry.last[id] = now[id];
            }
            if (pending > 0) scheduleFlush();
          },
          function () {
            entry.busy = false;
          }
        );
        if (entry.pc.connectionState === "closed") pcs.splice(pcs.indexOf(entry), 1);
      })(pcs[i]);
    }
    if (pcs.length === 0) {
      clearInterval(pollTimer);
      pollTimer = 0;
    }
  };

  var watch = function (pc) {
    pcs.push({ pc: pc, last: {}, busy: false });
    if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
  };

  var Wrapped = function RTCPeerConnection() {
    // Called without `new`: fail exactly like the native constructor does.
    if (!new.target) return Native.apply(this, arguments);
    // Construct for `new.target`, so a page's `class X extends RTCPeerConnection` still gets an
    // instance of X (with its own methods), not a plain native connection.
    var pc = Reflect.construct(Native, arguments, new.target);
    try {
      watch(pc);
    } catch (e) {}
    return pc;
  };
  Wrapped.prototype = Native.prototype;
  Object.setPrototypeOf(Wrapped, Native);
  try {
    Object.defineProperty(Wrapped, "name", { value: Native.name });
  } catch (e) {}
  window.RTCPeerConnection = Wrapped;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = Wrapped;
})();
