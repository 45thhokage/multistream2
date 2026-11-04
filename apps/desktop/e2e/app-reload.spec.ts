import { test, expect } from "@playwright/test";

test.describe("App Reload E2E Test", () => {
  test.beforeEach(async ({ page }) => {
    // Arrange: clean persistent state with one persisted stream
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("locale", "en");
      localStorage.setItem("preferences.onboardingCompleted", "true");
      localStorage.setItem("preferences.sidebarOpen", "true");
      localStorage.setItem(
        "streams",
        JSON.stringify([{ id: "e2e-xqc", channel: "xqc", platform: "kick" }])
      );
    });
    await page.reload();
    await expect(page.getByTestId("stream-item-xqc")).toBeVisible();
  });

  test("reload button reloads the whole app and restores streams", async ({ page }) => {
    // Act: reload the whole application
    await page.getByTestId("reload-app-btn").click();
    await page.waitForLoadState("load");

    // Assert: toolbar and persisted stream are back after reload
    await expect(page.getByTestId("reload-app-btn")).toBeVisible();
    await expect(page.getByTestId("stream-item-xqc")).toBeVisible();
  });

  test("force reload button reloads the whole app and restores streams", async ({ page }) => {
    // Act: force reload the whole application
    await page.getByTestId("force-reload-app-btn").click();
    await page.waitForLoadState("load");

    // Assert: toolbar and persisted stream are back after reload
    await expect(page.getByTestId("force-reload-app-btn")).toBeVisible();
    await expect(page.getByTestId("stream-item-xqc")).toBeVisible();
  });
});
