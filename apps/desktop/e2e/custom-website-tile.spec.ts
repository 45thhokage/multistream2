import { test, expect } from "@playwright/test";

test.describe("Custom Website Tile E2E Test", () => {
  test.beforeEach(async ({ page }) => {
    // Arrange: clean persistent state and mark onboarding as complete
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("locale", "en");
      localStorage.setItem("preferences.onboardingCompleted", "true");
      localStorage.setItem("preferences.sidebarOpen", "true");
    });
    await page.reload();
  });

  test("github url added as custom loads a browser tile in the grid", async ({ page }) => {
    // Arrange: open the add dialog on the custom platform and paste a site url
    await page.getByTestId("add-stream-btn").click();
    await page.getByTestId("platform-custom").click();
    await page.getByTestId("custom-url-input").fill("https://github.com/ilanzgx");
    await expect(page.getByTestId("add-submit-btn")).toBeEnabled();

    // Act: add the custom website
    await page.getByTestId("add-submit-btn").click();

    // Assert: grid item renders with the minibrowser chrome and address bar
    const item = page.getByTestId("stream-item-github.com");
    await expect(item).toBeVisible();
    const tile = page.getByTestId("browser-tile-github.com");
    await expect(tile).toBeVisible();
    await expect(page.getByTestId("browser-address-github.com")).toHaveValue(
      /github\.com\/ilanzgx/
    );
    await expect(page.getByTestId("browser-reload-github.com")).toBeVisible();
    await expect(page.getByTestId("browser-viewport-github.com")).toBeVisible();
  });

  test("tiktok watch url added as custom loads a browser tile", async ({ page }) => {
    // Arrange: tiktok embeds were removed, watch urls open as browser tiles
    await page.getByTestId("add-stream-btn").click();
    await page.getByTestId("platform-custom").click();
    await page
      .getByTestId("custom-url-input")
      .fill("https://www.tiktok.com/@user/video/7263847263847263");
    await expect(page.getByTestId("add-submit-btn")).toBeEnabled();

    // Act: add the tiktok url
    await page.getByTestId("add-submit-btn").click();

    // Assert: tile renders the minibrowser chrome with the watch url loaded
    const tile = page.getByTestId("browser-tile-tiktok.com");
    await expect(tile).toBeVisible();
    await expect(page.getByTestId("browser-address-tiktok.com")).toHaveValue(
      /tiktok\.com\/@user\/video\/7263847263847263/
    );
  });
});
