import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const mixer = fileURLToPath(new URL("../src-tauri/src/core/mixer.js", import.meta.url));

async function load(page: Page) {
  await page.route("https://feed.example.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" })
  );
  await page.addInitScript({ path: mixer });
  await page.goto("https://feed.example.test/");
  await page.evaluate(() => {
    const w = window as unknown as { __writes: number; __addVideo: (volume: number) => void };
    w.__writes = 0;
    document.addEventListener("volumechange", () => w.__writes++, true);
    w.__addVideo = (volume: number) => {
      const video = document.createElement("video");
      video.volume = volume;
      document.body.appendChild(video);
    };
    w.__addVideo(0.7);
  });
  // The page's own setup above fires a volumechange; count only what comes after it.
  await page.waitForTimeout(50);
  await page.evaluate(() => ((window as unknown as { __writes: number }).__writes = 0));
}

const post = (page: Page, volume: number) =>
  page.evaluate(
    (v) => window.postMessage({ type: "MULTISTREAM_MIXER_VOLUME", volume: v }, "*"),
    volume
  );
const volumes = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll("video")].map((v) => v.volume));
const writes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __writes: number }).__writes);

test("at 100% the page's own volume is never touched, however often the app repeats it", async ({
  page,
}) => {
  // Arrange
  await load(page);

  // Act: the app posts the volume every second
  for (let i = 0; i < 5; i++) await post(page, 1);
  await page.waitForTimeout(100);

  // Assert
  expect(await volumes(page)).toEqual([0.7]);
  expect(await writes(page)).toBe(0);
});

test("below 100% each video gets the volume once, and the page's own change is kept", async ({
  page,
}) => {
  // Arrange
  await load(page);

  // Act: the same value five times
  for (let i = 0; i < 5; i++) await post(page, 0.4);

  // Assert: written once
  await expect.poll(() => volumes(page)).toEqual([0.4]);
  expect(await writes(page)).toBe(1);

  // Act: the page changes it itself, then the app repeats the same value
  await page.evaluate(() => (document.querySelector("video")!.volume = 0.9));
  await post(page, 0.4);
  await page.waitForTimeout(100);

  // Assert: the page's choice stands
  expect(await volumes(page)).toEqual([0.9]);
});

test("returning to 100% gives the page back the volume it had", async ({ page }) => {
  // Arrange
  await load(page);
  await post(page, 0.4);
  await expect.poll(() => volumes(page)).toEqual([0.4]);

  // Act
  await post(page, 1);

  // Assert
  await expect.poll(() => volumes(page)).toEqual([0.7]);
});
