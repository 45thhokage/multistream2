import { test, expect } from "@playwright/test";

test.describe("Layout presets E2E Test", () => {
  test.beforeEach(async ({ page }) => {
    // Arrange: clean persistent state and mark onboarding as complete
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("locale", "en");
      localStorage.setItem("preferences.onboardingCompleted", "true");
      localStorage.setItem("preferences.sidebarOpen", "true");
    });
    // Reload to apply localStorage changes
    await page.reload();
  });

  async function addStream(page: any, platform: "kick" | "twitch", channel: string) {
    await page.getByTestId("add-stream-btn").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByTestId(`platform-${platform}`).click();
    await page.getByTestId("channel-input").fill(channel);
    await page.getByTestId("add-submit-btn").click();
    await expect(page.getByTestId(`stream-item-${channel}`)).toBeVisible();
  }

  test("open picker -> select Stack -> both streams stay visible without reload", async ({
    page,
  }) => {
    // Arrange: two live streams in the grid
    await addStream(page, "kick", "xqc");
    await addStream(page, "twitch", "shroud");
    await page.waitForTimeout(3500);

    const xqcFrameCount = await page.getByTestId("stream-item-xqc").locator("iframe").count();

    // Act: open the layout picker and choose Stack
    await page.getByTestId("layout-picker-btn").click();
    await expect(page.getByTestId("layout-panel")).toBeVisible();
    await page.getByTestId("layout-option-stack").click();

    // Assert: panel closes, both streams still mounted, layout persisted
    await expect(page.getByTestId("layout-panel")).not.toBeVisible();
    await expect(page.getByTestId("stream-item-xqc")).toBeVisible();
    await expect(page.getByTestId("stream-item-shroud")).toBeVisible();
    expect(await page.getByTestId("stream-item-xqc").locator("iframe").count()).toBe(xqcFrameCount);
    const stored = await page.evaluate(() => localStorage.getItem("preferences.streamLayout"));
    expect(stored).toBe("stack");
  });

  test("immersive mode hides the layout toolbar without unmounting streams", async ({ page }) => {
    // Arrange
    await addStream(page, "kick", "xqc");
    await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
    const stream = page.getByTestId("stream-item-xqc");
    const frame = await stream.locator("iframe").elementHandle();
    await expect(page.getByTestId("layout-picker-btn")).toBeVisible();

    // Act
    await page.getByTestId("immersive-mode-btn").click();

    // Assert
    await expect(page.getByTestId("layout-picker-btn")).not.toBeVisible();
    await expect(stream).toBeVisible();
    expect(await frame?.evaluate((element) => element.isConnected)).toBe(true);

    // Act
    await page.mouse.move(500, 300);
    await expect(page.getByTestId("immersive-right-trigger")).toBeVisible();
    await expect(page.getByTestId("immersive-mode-btn")).not.toBeInViewport();
    await page.locator("body").press("Escape");

    // Assert
    await expect(page.getByTestId("layout-picker-btn")).toBeVisible();
    expect(await frame?.evaluate((element) => element.isConnected)).toBe(true);
  });

  test("selected layout survives reload", async ({ page }) => {
    // Arrange: stored layout preference (vueuse stores strings raw, unquoted)
    await page.evaluate(() => {
      localStorage.setItem("preferences.streamLayout", "theater");
    });
    await addStream(page, "kick", "xqc");

    // Act: reload and reopen the picker
    await page.reload();
    await expect(page.getByTestId("stream-item-xqc")).toBeVisible();
    await page.getByTestId("layout-picker-btn").click();

    // Assert: Theater is marked as the active option
    await expect(page.getByTestId("layout-option-theater")).toHaveAttribute("aria-pressed", "true");
  });
});
