import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../src-tauri/src/core/max_quality.js", import.meta.url));

const MASTER = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=980000,BANDWIDTH=1210000,RESOLUTION=854x480,CODECS="avc1.42c01f,mp4a.40.2"
https://cdn.example.test/tracks-v3a2/index.ll.m3u8?token=x
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1610000,BANDWIDTH=1990000,RESOLUTION=1280x720,CODECS="avc1.42c01f,mp4a.40.2"
https://cdn.example.test/tracks-v4a2/index.ll.m3u8?token=x
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=240000,BANDWIDTH=280000,RESOLUTION=256x144,CODECS="avc1.42c01f,mp4a.40.2"
https://cdn.example.test/tracks-v1a2/index.ll.m3u8?token=x
`;
const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXTINF:2.0,
seg-1.mp4
`;

async function load(page: Page, host: string) {
  await page.route(`https://${host}/room`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" })
  );
  await page.route("https://cdn.example.test/**", (route) =>
    route.fulfill({
      contentType: "application/vnd.apple.mpegurl",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: route.request().url().includes("master") ? MASTER : MEDIA,
    })
  );
  await page.addInitScript({ path: script });
  await page.goto(`https://${host}/room`);
}

const viaXhr = (page: Page, url: string) =>
  page.evaluate(
    (u) =>
      new Promise<string>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", u);
        xhr.onload = () => resolve(xhr.responseText);
        xhr.send();
      }),
    url
  );
const viaFetch = (page: Page, url: string) =>
  page.evaluate((u) => fetch(u).then((r) => r.text()), url);

test("on CamSoda the master playlist keeps only its best variant, by XHR and by fetch", async ({
  page,
}) => {
  // Arrange
  await load(page, "www.camsoda.com");

  // Act
  const xhr = await viaXhr(page, "https://cdn.example.test/master.m3u8?multitrack=true");
  const fetched = await viaFetch(page, "https://cdn.example.test/master.m3u8?multitrack=true");

  // Assert: one variant, the 720p one, with its URI
  for (const text of [xhr, fetched]) {
    expect(text.match(/#EXT-X-STREAM-INF/g)).toHaveLength(1);
    expect(text).toContain("RESOLUTION=1280x720");
    expect(text).toContain("tracks-v4a2/index.ll.m3u8");
    expect(text).not.toContain("tracks-v1a2");
  }
});

test("media playlists pass through, and other sites are never touched", async ({ page }) => {
  // Arrange
  await load(page, "www.camsoda.com");

  // Act / Assert: a media playlist is unchanged
  expect(await viaXhr(page, "https://cdn.example.test/tracks-v4a2/index.ll.m3u8")).toBe(MEDIA);

  // Arrange: another site
  await load(page, "www.example.org");

  // Act / Assert: its master playlist keeps every variant
  const text = await viaXhr(page, "https://cdn.example.test/master.m3u8");
  expect(text.match(/#EXT-X-STREAM-INF/g)).toHaveLength(3);
});
