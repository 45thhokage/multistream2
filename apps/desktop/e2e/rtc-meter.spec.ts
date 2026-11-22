import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const script = path.resolve("src-tauri/src/core/rtc_meter.js");

// A loopback WebRTC pair that moves `kb` kilobytes over a data channel.
const LOOPBACK = `
  async function loopback(kb) {
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
    const channel = a.createDataChannel("d");
    let received = 0;
    const done = new Promise((resolve) => {
      b.ondatachannel = (e) => {
        e.channel.onmessage = (m) => {
          received += m.data.byteLength || m.data.length;
          if (received >= kb * 1024) resolve(received);
        };
      };
    });
    await new Promise((resolve) => { channel.onopen = resolve; a.createOffer().then(async (o) => {
      await a.setLocalDescription(o); await b.setRemoteDescription(o);
      const answer = await b.createAnswer(); await b.setLocalDescription(answer); await a.setRemoteDescription(answer);
    }); });
    const chunk = new Uint8Array(16 * 1024);
    for (let i = 0; i < kb / 16; i++) { channel.send(chunk); await new Promise((r) => setTimeout(r, 5)); }
    return done;
  }
`;

async function open(page: Page, html: string) {
  await page.addInitScript(() => {
    (window as unknown as { __rtc: number[] }).__rtc = [];
    (window as unknown as { chrome: unknown }).chrome = {
      webview: {
        postMessage: (text: string) => {
          const message = JSON.parse(text);
          if (message.t === "rtc")
            (window as unknown as { __rtc: number[] }).__rtc.push(message.bytes);
        },
      },
    };
  });
  await page.addInitScript({ path: script });
  await page.route("https://rtc.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html })
  );
  await page.goto("https://rtc.test/");
}

const reported = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __rtc: number[] }).__rtc.reduce((sum, bytes) => sum + bytes, 0)
  );

test("WebRTC bytes received in the page are reported to the app", async ({ page }) => {
  // Arrange
  await open(page, `<!doctype html><script>${LOOPBACK}</script>`);

  // Act: 400 KB over a data channel
  await page.evaluate(() =>
    (window as unknown as { loopback(kb: number): Promise<number> }).loopback(400)
  );
  await expect.poll(() => reported(page), { timeout: 8000 }).toBeGreaterThan(400 * 1024);

  // Assert: counted once per direction at most, not wildly inflated
  expect(await reported(page)).toBeLessThan(400 * 1024 * 3);
});

test("WebRTC inside an iframe is relayed through the top frame", async ({ page }) => {
  // Arrange: the connections live in an embedded player, the top page has none
  const frame = `<!doctype html><script>${LOOPBACK}; loopback(400);</script>`;
  await open(page, `<!doctype html><iframe srcdoc="${frame.replace(/"/g, "&quot;")}"></iframe>`);

  // Assert
  await expect.poll(() => reported(page), { timeout: 10000 }).toBeGreaterThan(400 * 1024);
});

test("the page's own RTCPeerConnection keeps working and keeps its identity", async ({ page }) => {
  // Arrange / Act
  await open(page, "<!doctype html><body></body>");
  const result = await page.evaluate(() => {
    const pc = new RTCPeerConnection();
    const out = {
      isInstance: pc instanceof RTCPeerConnection,
      name: RTCPeerConnection.name,
      hasStatic: typeof RTCPeerConnection.generateCertificate,
      state: pc.signalingState,
    };
    pc.close();
    return out;
  });

  // Assert
  expect(result).toEqual({
    isInstance: true,
    name: "RTCPeerConnection",
    hasStatic: "function",
    state: "stable",
  });
});

test("a page's subclass of RTCPeerConnection keeps its own methods", async ({ page }) => {
  // Arrange
  await open(page, "<!doctype html><body></body>");

  // Act
  const result = await page.evaluate(() => {
    class Peer extends RTCPeerConnection {
      hello() {
        return "hi";
      }
    }
    const pc = new Peer();
    let threw = false;
    try {
      (RTCPeerConnection as unknown as () => unknown)();
    } catch {
      threw = true;
    }
    const out = {
      isPeer: pc instanceof Peer,
      isNative: pc instanceof RTCPeerConnection,
      hello: typeof pc.hello === "function" ? pc.hello() : null,
      withoutNewThrows: threw,
    };
    pc.close();
    return out;
  });

  // Assert
  expect(result).toEqual({ isPeer: true, isNative: true, hello: "hi", withoutNewThrows: true });
});
