import { test, expect } from "@playwright/test";

test.describe("Seeded Boot With Browser Tiles", () => {
  test("app boots with persisted custom streams and same-domain favorites", async ({ page }) => {
    // Arrange: seed the exact persisted state a returning user has
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("locale", "en");
      localStorage.setItem("preferences.onboardingCompleted", "true");
      localStorage.setItem(
        "streams",
        JSON.stringify([
          {
            id: "seed-id-1",
            channel: "github.com",
            platform: "custom",
            iframeUrl: "https://github.com/gorhill/ublock",
          },
          {
            id: "seed-id-2",
            channel: "github.com",
            platform: "custom",
            iframeUrl: "https://github.com/gorhill/",
          },
        ])
      );
      localStorage.setItem(
        "favorites",
        JSON.stringify([
          {
            channel: "github.com",
            platform: "custom",
            iframeUrl: "https://github.com/gorhill/ublock",
            displayName: "uBlock Origin",
            faviconUrl: "https://github.com/favicon.ico",
            siteUrl: "https://github.com/gorhill/ublock",
            addedAt: 1700000000000,
          },
          {
            channel: "github.com",
            platform: "custom",
            iframeUrl: "https://github.com/gorhill/",
            displayName: "gorhill",
            faviconUrl: "https://github.com/favicon.ico",
            siteUrl: "https://github.com/gorhill/",
            addedAt: 1700000001000,
          },
        ])
      );
    });

    // Act: boot the app with that state
    await page.reload();

    // Assert: shell renders and both browser tiles mount their chrome
    // (the desktop/mobile toggle only exists in Tauri, so assert the shared chrome)
    await expect(page.getByTestId("add-stream-btn")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("stream-item-github.com").first()).toBeVisible();
    await expect(page.getByTestId("browser-tile-github.com").first()).toBeVisible();
    await expect(page.getByTestId("browser-address-github.com").first()).toHaveValue(/github\.com/);
    await expect(page.getByTestId("browser-reload-github.com").first()).toBeVisible();
  });
});
