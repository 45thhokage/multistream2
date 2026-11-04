import { test, expect, type Page } from "@playwright/test";
import { LAYOUTS } from "../src/config/layouts";

async function seed(page: Page, count: number, layout = "auto") {
  await page.route("https://player.kick.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="background:#14161a;color:white">Test stream</body></html>',
    })
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(
    ({ count, layout }) => {
      localStorage.clear();
      localStorage.setItem("locale", "en");
      localStorage.setItem("preferences.onboardingCompleted", "true");
      localStorage.setItem("preferences.streamLayout", layout);
      localStorage.setItem(
        "streams",
        JSON.stringify(
          Array.from({ length: count }, (_, index) => ({
            id: `layout-${index}`,
            channel: `layout${index}`,
            platform: "kick",
          }))
        )
      );
    },
    { count, layout }
  );
  await page.reload();
}

async function pick(page: Page, id: string) {
  await page.getByTestId("layout-picker-btn").click();
  await page.getByTestId(`layout-option-${id}`).click();
  await expect(page.getByTestId("layout-panel")).not.toBeVisible();
}

test.describe("Layout geometry and playback", () => {
  for (const width of [1366, 1024]) {
    test(`layout picker stays inside a ${width}px laptop viewport`, async ({ page }, testInfo) => {
      // Arrange
      await page.setViewportSize({ width, height: 768 });
      await seed(page, 3, "focus");
      await page.screenshot({ path: testInfo.outputPath("focus.png") });
      await pick(page, "pip-2-corners");
      await page.screenshot({ path: testInfo.outputPath("pip-corners.png") });
      await pick(page, "mosaic-9");
      await page.screenshot({ path: testInfo.outputPath("mosaic.png") });

      // Act
      await page.getByTestId("layout-picker-btn").click();
      const panel = page.getByTestId("layout-panel");
      const bounds = await panel.boundingBox();
      await page.screenshot({ path: testInfo.outputPath("picker.png") });

      // Assert
      expect(bounds).not.toBeNull();
      if (!bounds) return;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(768);

      // Act
      await page.keyboard.press("Escape");

      // Assert
      await expect(panel).not.toBeVisible();
      await expect(page.getByTestId("layout-picker-btn")).toBeFocused();
    });
  }
  test("all presets match their preview geometry, including their empty panes", async ({
    page,
  }) => {
    // Arrange
    await seed(page, 1);
    const source = await page.getByTestId("stream-item-layout0").locator("iframe").elementHandle();

    for (const layout of LAYOUTS.filter((layout) => layout.id !== "auto")) {
      // Act
      await pick(page, layout.id);
      const boxes = await page.getByTestId("workspace-grid-default").evaluate((grid) => {
        const frame = grid.getBoundingClientRect();
        return [
          ...grid.querySelectorAll<HTMLElement>(
            '[data-stream-id], [data-testid="layout-placeholder"]'
          ),
        ].map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: (rect.x - frame.x) / frame.width,
            y: (rect.y - frame.y) / frame.height,
            w: rect.width / frame.width,
            h: rect.height / frame.height,
          };
        });
      });

      // Assert
      expect(boxes, layout.id).toHaveLength(layout.slots.length);
      for (let index = 0; index < layout.slots.length; index++) {
        const expected = layout.slots[index];
        const actual = boxes[index];
        expect(expected, layout.id).toBeDefined();
        expect(actual, layout.id).toBeDefined();
        if (!expected || !actual) continue;
        for (const dimension of ["x", "y", "w", "h"] as const) {
          expect(
            Math.abs(actual[dimension] - expected[dimension]),
            `${layout.id} slot ${index} ${dimension}`
          ).toBeLessThan(0.035);
        }
      }
      expect(await source?.evaluate((element) => element.isConnected), layout.id).toBe(true);
    }
  });

  test("layout changes preserve every player and expand undersized layouts", async ({ page }) => {
    // Arrange
    await seed(page, 5);
    const frames = await page.locator("[data-stream-id] iframe").elementHandles();

    // Act
    await pick(page, "duo");

    // Assert
    await expect(page.locator("[data-stream-id]:visible")).toHaveCount(5);
    await page.getByTestId("layout-picker-btn").click();
    await expect(page.getByTestId("layout-expanded-notice")).toContainText("5 streams");
    await page.keyboard.press("Escape");

    // Act
    await pick(page, "pip-4");
    await pick(page, "mosaic-6");
    await pick(page, "solo");

    // Assert
    await expect(page.locator("[data-stream-id]:visible")).toHaveCount(1);
    for (const frame of frames)
      expect(await frame.evaluate((element) => element.isConnected)).toBe(true);

    // Act
    await pick(page, "auto");

    // Assert
    await expect(page.locator("[data-stream-id]:visible")).toHaveCount(5);
    for (const frame of frames)
      expect(await frame.evaluate((element) => element.isConnected)).toBe(true);
  });

  test("saving and restoring a PiP layout retains its overlay geometry across reload", async ({
    page,
  }) => {
    // Arrange
    await seed(page, 3, "pip-2-corners");
    const before = await page
      .locator("[data-stream-id]")
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLElement).getAttribute("style"))
      );

    // Act
    await page.getByTestId("layout-picker-btn").click();
    await page.getByTestId("layout-save-current").click();
    const savedId = await page.evaluate(() => localStorage.getItem("preferences.streamLayout"));
    await page.reload();

    // Assert
    expect(savedId).toMatch(/^custom-/);
    await expect(page.locator("[data-stream-id]:visible")).toHaveCount(3);
    const after = await page
      .locator("[data-stream-id]")
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLElement).getAttribute("style"))
      );
    expect(after).toEqual(before);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("custom-layouts") ?? "[]")[0].slots)
    ).toHaveLength(3);
  });

  test("an empty workspace shows the selected layout and its add-stream panes", async ({
    page,
  }) => {
    // Arrange
    await seed(page, 0);

    // Act
    await pick(page, "focus");

    // Assert
    await expect(page.getByTestId("layout-placeholder")).toHaveCount(3);

    // Act
    await page.getByTestId("layout-placeholder").nth(1).click();

    // Assert
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("a 4 by 4 layout displays all sixteen saved streams", async ({ page }) => {
    // Arrange
    await seed(page, 16, "grid-4x4");

    // Assert
    await expect(page.locator("[data-stream-id]:visible")).toHaveCount(16);
    await expect(page.getByTestId("layout-placeholder")).toHaveCount(0);
  });
});
