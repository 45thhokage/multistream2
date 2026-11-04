import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("volume injection never changes the site's mute flag or writes zero volume", async ({
  page,
}) => {
  // Arrange
  await page.setContent('<video id="media"></video>');
  await page.locator("video").evaluate((element: HTMLVideoElement) => {
    element.muted = false;
    element.volume = 0.75;
  });
  await page.addScriptTag({
    path: fileURLToPath(new URL("../src-tauri/src/core/mixer.js", import.meta.url)),
  });

  // Act
  await page.evaluate(() => {
    window.postMessage({ type: "MULTISTREAM_MIXER", muted: true, volume: 0 }, "*");
    window.postMessage({ type: "MULTISTREAM_MIXER_VOLUME", volume: 0 }, "*");
  });
  await page.waitForTimeout(50);

  // Assert
  expect(
    await page
      .locator("video")
      .evaluate((element: HTMLVideoElement) => ({ muted: element.muted, volume: element.volume }))
  ).toEqual({ muted: false, volume: 0.75 });

  // Act
  await page.evaluate(() =>
    window.postMessage({ type: "MULTISTREAM_MIXER_VOLUME", volume: 0.4 }, "*")
  );

  // Assert
  await expect
    .poll(() => page.locator("video").evaluate((element: HTMLVideoElement) => element.volume))
    .toBe(0.4);
  expect(await page.locator("video").evaluate((element: HTMLVideoElement) => element.muted)).toBe(
    false
  );
});

test("the sidebar routes mute to the native output while leaving page media alone", async ({
  page,
}) => {
  // Arrange
  await page.route("http://localhost/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const file = new URL(`../dist${pathname === "/" ? "/index.html" : pathname}`, import.meta.url);
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: pathname.endsWith(".js")
          ? "application/javascript"
          : pathname.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    localStorage.setItem("preferences.followedSidebarOpen", "true");
    localStorage.setItem(
      "streams",
      JSON.stringify([{ id: "one", channel: "shroud", platform: "twitch" }])
    );
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    const host = window as unknown as { __TAURI_INTERNALS__: unknown; nativeAudioCalls: unknown[] };
    host.nativeAudioCalls = [];
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === "tile_set_audio") host.nativeAudioCalls.push(args);
        if (command === "plugin:event|listen") return 1;
        if (command === "open_player_webview") return "tile-one";
        if (command === "check_network_connectivity") return true;
        if (command.startsWith("plugin:http|")) throw new Error("network disabled in test");
        return [];
      },
    };
  });
  await page.goto("http://localhost/");
  await expect(page.locator('[data-native-stream="one"]')).toBeVisible();
  await page.getByTestId("stream-item-shroud").evaluate((container) => {
    const media = document.createElement("video");
    media.id = "test-media";
    media.muted = false;
    media.volume = 0.65;
    container.append(media);
  });

  // Act
  await page
    .getByTestId("mixer-channel-shroud")
    .getByRole("button", { name: "Mute", exact: true })
    .click();

  // Assert
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as unknown as { nativeAudioCalls: { tileId: string; muted: boolean }[] }
        ).nativeAudioCalls;
        return calls.some((call) => call.tileId === "one" && call.muted);
      })
    )
    .toBe(true);
  expect(
    await page
      .locator("#test-media")
      .evaluate((element: HTMLVideoElement) => ({ muted: element.muted, volume: element.volume }))
  ).toEqual({ muted: false, volume: 0.65 });
});
