import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

async function builtApp(page: Page) {
  await page.route("http://localhost/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    try {
      await route.fulfill({
        body: await readFile(
          new URL(`../dist${path === "/" ? "/index.html" : path}`, import.meta.url)
        ),
        contentType: path.endsWith(".js")
          ? "application/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    localStorage.setItem("preferences.followedSidebarOpen", "true");
    localStorage.setItem(
      "streams",
      JSON.stringify([
        { id: "one", channel: "shroud", platform: "twitch" },
        { id: "two", channel: "test", platform: "kick" },
      ])
    );
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    const host = window as unknown as {
      __TAURI_INTERNALS__: unknown;
      calls: { command: string; args: Record<string, unknown> }[];
      callbacks: Record<number, (event: unknown) => void>;
      events: Record<string, number>;
    };
    host.calls = [];
    host.callbacks = {};
    host.events = {};
    let next = 1;
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: (callback: (event: unknown) => void) => {
        const id = next++;
        host.callbacks[id] = callback;
        return id;
      },
      unregisterCallback: (id: number) => {
        delete host.callbacks[id];
      },
      invoke: async (command: string, args: Record<string, unknown>) => {
        host.calls.push({ command, args });
        if (command === "plugin:event|listen") {
          host.events[String(args.event)] = Number(args.handler);
          return 1;
        }
        if (command === "open_player_webview") return `tile-${args.tileId}`;
        if (command === "twitch_get_auth_state") return { authenticated: true, username: "viewer" };
        if (command === "twitch_get_followed_streams")
          return [
            {
              id: "following-test",
              platform: "twitch",
              displayName: "Following Preview Test",
              avatarUrl: "",
              isLive: true,
              title: "Test broadcast",
              game: "Just Chatting",
              viewerCount: 10,
            },
          ];
        if (command === "check_network_connectivity") return true;
        if (command.startsWith("plugin:http|")) throw new Error("network disabled in test");
        return [];
      },
    };
  });
}

test("Layout opens above native players without hiding any stream", async ({ page }) => {
  // Arrange
  await builtApp(page);
  await page.goto("http://localhost/");
  await expect(page.locator('[data-native-stream="one"]')).toBeVisible();
  // Act
  await page.getByTestId("layout-picker-btn").click();
  // Assert
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { calls: { command: string }[] }).calls.some(
          (call) => call.command === "open_ui_overlay"
        )
      )
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { calls: { command: string; args: { visible?: boolean } }[] }
      ).calls.filter((call) => call.command === "tile_set_visible" && call.args.visible === false)
    )
  ).toEqual([]);
  await expect(page.locator('[data-native-stream="two"]')).toBeVisible();
  expect(
    await page
      .getByTestId("audio-mode-picker")
      .evaluate((select) => select.getBoundingClientRect().right)
  ).toBeLessThan(
    await page
      .getByTestId("layout-picker-btn")
      .evaluate((button) => button.getBoundingClientRect().left)
  );
});

test("audio modes and the manual Focus button control per-stream output", async ({ page }) => {
  // Arrange
  await builtApp(page);
  await page.goto("http://localhost/");
  await expect(page.locator('[data-native-stream="one"]')).toBeVisible();
  // Act
  await page.getByTestId("audio-mode-picker").selectOption("manual");
  await page
    .getByTestId("mixer-channel-test")
    .getByRole("button", { name: "Focus", exact: true })
    .click();
  // Assert
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as unknown as {
            calls: { command: string; args: { tileId: string; muted: boolean } }[];
          }
        ).calls.filter((call) => call.command === "tile_set_audio");
        return [
          calls.findLast((call) => call.args.tileId === "one")?.args.muted,
          calls.findLast((call) => call.args.tileId === "two")?.args.muted,
        ];
      })
    )
    .toEqual([true, false]);
  await expect(page.getByTestId("mixer-channel-shroud")).toContainText("0%");
  await expect(page.getByTestId("mixer-channel-test")).toContainText("100%");
});

test("the sidebar offers reported player qualities and sends the selected quality", async ({
  page,
}, testInfo) => {
  // Arrange
  await builtApp(page);
  await page.goto("http://localhost/");
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { events: Record<string, number> }).events["native-player-quality"]
    )
  );
  // Act
  await page.evaluate(() => {
    const host = window as unknown as {
      callbacks: Record<number, (event: unknown) => void>;
      events: Record<string, number>;
    };
    host.callbacks[host.events["native-player-quality"]!]!({
      payload: {
        tileId: "one",
        report: {
          options: [
            { id: "auto", label: "auto" },
            { id: "720p60", label: "720p60" },
          ],
          current: "auto",
        },
      },
    });
  });
  await page.getByRole("combobox", { name: "Quality for shroud" }).selectOption("720p60");
  // Assert
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { calls: { command: string; args: unknown }[] }).calls
          .filter((call) => call.command === "tile_set_quality")
          .map((call) => call.args)
      )
    )
    .toEqual([{ tileId: "one", quality: "720p60" }]);
  await page.screenshot({ path: testInfo.outputPath("audio-controls.png") });
});

test("hovering Following opens a native thumbnail layer using the channel fallback", async ({
  page,
}) => {
  // Arrange
  await builtApp(page);
  await page.goto("http://localhost/");
  // Act
  await page.getByText("Following Preview Test", { exact: true }).hover();
  // Assert
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            calls: { command: string; args: { kind: string; data: string } }[];
          }
        ).calls
          .filter((call) => call.command === "open_ui_overlay" && call.args.kind === "preview")
          .map((call) => JSON.parse(call.args.data).thumbnail)
      )
    )
    .toEqual(["https://static-cdn.jtvnw.net/previews-ttv/live_user_following-test-320x180.jpg"]);
});

test("the native layout layer keeps the existing layout options working", async ({ page }) => {
  // Arrange
  await builtApp(page);
  await page.goto("http://localhost/?nativeOverlay=layout&data=%7B%7D");
  // Act
  await page.getByTestId("layout-option-quad").click();
  // Assert
  expect(await page.evaluate(() => localStorage.getItem("preferences.streamLayout"))).toBe("quad");
});

test("quality injection switches the player rendition without muting or recreating media", async ({
  page,
}) => {
  // Arrange
  await page.setContent('<video id="media"></video>');
  await page.evaluate(() => {
    const levels = [
      { group: "720p60", height: 720, framerate: 60 },
      { group: "480p", height: 480 },
    ];
    const host = window as unknown as { player: unknown; changed: unknown[] };
    host.changed = [];
    host.player = {
      getQualities: () => levels,
      setAutoQualityMode: () => {},
      setQuality: (quality: unknown) => {
        host.changed.push(quality);
      },
      getQuality: () => levels[0],
    };
  });
  await page.addScriptTag({
    path: fileURLToPath(new URL("../src-tauri/src/core/quality.js", import.meta.url)),
  });
  // Act
  await page.evaluate(() =>
    window.postMessage({ type: "MULTISTREAM_QUALITY_REQUEST", quality: "480p" }, "*")
  );
  // Assert
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { changed: { group: string }[] }).changed.map(
          (quality) => quality.group
        )
      )
    )
    .toEqual(["480p"]);
  expect(
    await page
      .locator("#media")
      .evaluate((video: HTMLVideoElement) => ({ muted: video.muted, volume: video.volume }))
  ).toEqual({ muted: false, volume: 1 });
});

test("the native hover preview renders its thumbnail and channel information", async ({ page }) => {
  // Arrange
  await builtApp(page);
  await page.route("https://cdn.example/preview.jpg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#abc"/></svg>',
    })
  );
  const data = encodeURIComponent(
    JSON.stringify({
      thumbnail: "https://cdn.example/preview.jpg",
      title: "Live broadcast",
      category: "Just Chatting",
    })
  );
  // Act
  await page.goto(`http://localhost/?nativeOverlay=preview&data=${data}`);
  // Assert
  await expect(page.getByTestId("channel-preview")).toContainText("Live broadcast");
  await expect
    .poll(() => page.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(320);
});
