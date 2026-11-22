import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const script = path.resolve("src-tauri/src/core/fit_video.js");

const PAGE = (video = 'width="640" height="360"') => `<!doctype html><html><head><style>
  body { margin: 0; font: 14px sans-serif }
  header { height: 60px; background: #ccc }
  .row { display: flex }
  aside { width: 200px; height: 500px; background: #eee }
  .player { position: relative; width: 640px; height: 360px; transform: translateZ(0) }
  .controls { position: absolute; bottom: 0; left: 0; right: 0; height: 30px; background: #333 }
  video { display: block; background: #222 }
</style></head><body style="padding: 0 4px">
  <header>site header</header>
  <div class="row">
    <aside>chat</aside>
    <main><div class="player" style="outline: 1px solid red"><video ${video}></video><div class="controls">controls</div></div></main>
  </div>
  <footer>footer</footer>
</body></html>`;

async function load(page: Page, html = PAGE(), url = "https://example.test/watch") {
  await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.addInitScript(() => {
    (window as unknown as { __states: string[] }).__states = [];
    (window as unknown as { chrome: unknown }).chrome = {
      webview: {
        postMessage: (text: string) =>
          (window as unknown as { __states: string[] }).__states.push(JSON.parse(text).state),
      },
    };
  });
  await page.addInitScript({ path: script });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(url);
}

const states = (page: Page) =>
  page.evaluate(() => (window as unknown as { __states: string[] }).__states);
const fitted = (page: Page) =>
  page.evaluate(() => document.documentElement.hasAttribute("data-ms-fit"));
const play = (page: Page) =>
  page.evaluate(() => document.querySelector("video")!.dispatchEvent(new Event("play")));

test("the button fits the video to the tile and exit restores the page exactly", async ({
  page,
}) => {
  // Arrange
  await load(page);
  const before = await page.evaluate(() => document.documentElement.outerHTML);
  const sheets = await page.evaluate(() => document.adoptedStyleSheets.length);

  // Act
  await page.evaluate(() =>
    (window as unknown as { __msFit: { toggle(): void } }).__msFit.toggle()
  );

  // Assert: the video fills the viewport, the rest of the page is hidden, the controls stay
  expect(await fitted(page)).toBe(true);
  const box = (await page.locator("video").boundingBox())!;
  expect(Math.round(box.width)).toBe(1000);
  expect(Math.round(box.height)).toBe(700);
  await expect(page.locator("header")).toBeHidden();
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.locator("footer")).toBeHidden();
  await expect(page.locator(".controls")).toBeVisible();

  // Act: a second click puts it back
  await page.evaluate(() =>
    (window as unknown as { __msFit: { toggle(): void } }).__msFit.toggle()
  );

  // Assert: byte-for-byte the same document, no leftover stylesheet
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(before);
  expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(sheets);
  expect(await states(page)).toEqual(["on", "off"]);
});

test("Esc and the exit chip put the page back", async ({ page }) => {
  // Arrange
  await load(page);
  const before = await page.evaluate(() => document.documentElement.outerHTML);
  await page.evaluate(() =>
    (window as unknown as { __msFit: { toggle(): void } }).__msFit.toggle()
  );

  // Act
  await page.keyboard.press("Escape");

  // Assert
  expect(await fitted(page)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(before);

  // Act: again, this time through the chip in the top-right corner
  await page.evaluate(() =>
    (window as unknown as { __msFit: { toggle(): void } }).__msFit.toggle()
  );
  await page.mouse.click(1000 - 40, 20);

  // Assert
  expect(await fitted(page)).toBe(false);
});

test("a wrapper with will-change: transform does not keep the video in its old box", async ({
  page,
}) => {
  // Arrange: `will-change: transform` makes the wrapper the containing block of fixed children
  await load(
    page,
    PAGE().replace('<div class="row">', '<div class="row" style="will-change: transform">')
  );

  // Act
  await page.evaluate(() =>
    (window as unknown as { __msFit: { toggle(): void } }).__msFit.toggle()
  );

  // Assert
  const box = (await page.locator("video").boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.y)).toBe(0);
  expect(Math.round(box.width)).toBe(1000);
  expect(Math.round(box.height)).toBe(700);
});

test("a site's own !important id rules do not leave the video in the top-left corner", async ({
  page,
}) => {
  // Arrange: like many players, the size is pinned by an id selector with !important
  await load(
    page,
    PAGE()
      .replace('<div class="player"', '<div id="player" class="player"')
      .replace(
        "</style>",
        "#player { width: 640px !important; height: 360px !important; position: relative !important; } #player video { width: 640px !important; height: 360px !important; }</style>"
      )
  );

  // Act
  await page.evaluate(() =>
    (window as unknown as { __msFit: { toggle(): void } }).__msFit.toggle()
  );

  // Assert: the whole tile, not the old 640x360 box at 0,0
  const box = (await page.locator("video").boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.y)).toBe(0);
  expect(Math.round(box.width)).toBe(1000);
  expect(Math.round(box.height)).toBe(700);
  await expect(page.locator(".controls")).toBeVisible();
});

test("a page without a video reports that nothing was found", async ({ page }) => {
  // Arrange
  await load(page, "<!doctype html><body><p>no video</p></body>");

  // Act
  await page.evaluate(() =>
    (window as unknown as { __msFit: { toggle(): void } }).__msFit.toggle()
  );

  // Assert
  expect(await fitted(page)).toBe(false);
  expect(await states(page)).toEqual(["none"]);
});

test("pressing play inside the video fits it automatically", async ({ page }) => {
  // Arrange
  await load(page);

  // Act: click on the video, then it starts playing
  await page.mouse.click(300, 200);
  await play(page);

  // Assert
  expect(await fitted(page)).toBe(true);
});

test("autoplay and clicks elsewhere do not fit automatically", async ({ page }) => {
  // Arrange
  await load(page);

  // Act / Assert: autoplay, no click at all
  await play(page);
  expect(await fitted(page)).toBe(false);

  // Act / Assert: a click on something that is not the video (a thumbnail, say)
  await page.mouse.click(100, 300);
  await play(page);
  expect(await fitted(page)).toBe(false);
});

test("small videos and videos that already fill the tile are left alone", async ({ page }) => {
  // Arrange: 160x90 is below the 200x110 floor
  await load(page, PAGE('width="160" height="90"'));

  // Act
  await page.mouse.click(220, 120);
  await play(page);

  // Assert
  expect(await fitted(page)).toBe(false);
});

test("a video already filling 92% of the tile is left alone", async ({ page }) => {
  // Arrange
  await load(
    page,
    `<!doctype html><body style="margin:0"><video style="display:block;width:100vw;height:100vh"></video></body>`
  );

  // Act
  await page.mouse.click(300, 300);
  await play(page);

  // Assert
  expect(await fitted(page)).toBe(false);
});

test("automatic fit can be switched off, and never runs on TikTok", async ({ page }) => {
  // Arrange: the setting off
  await load(page);
  await page.evaluate(
    () => ((window as unknown as { __MS_FIT_AUTO: boolean }).__MS_FIT_AUTO = false)
  );

  // Act
  await page.mouse.click(300, 200);
  await play(page);

  // Assert
  expect(await fitted(page)).toBe(false);
});

test("TikTok is never fitted automatically but the button still works", async ({ page }) => {
  // Arrange
  await load(page, PAGE(), "https://www.tiktok.com/@someone/video/1");

  // Act
  await page.mouse.click(300, 200);
  await play(page);

  // Assert: no automatic fit
  expect(await fitted(page)).toBe(false);

  // Act: the button
  await page.evaluate(() =>
    (window as unknown as { __msFit: { toggle(): void } }).__msFit.toggle()
  );

  // Assert
  expect(await fitted(page)).toBe(true);
});
