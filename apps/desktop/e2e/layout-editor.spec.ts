import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, count: number, layout = "quad") {
  await page.route("https://player.kick.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="background:#14161a;color:white">Test stream</body></html>',
    })
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1366, height: 820 });
  await page.goto("/");
  await page.evaluate(
    ({ count: total, layout: layoutId }) => {
      localStorage.clear();
      localStorage.setItem("locale", "en");
      localStorage.setItem("preferences.onboardingCompleted", "true");
      localStorage.setItem("preferences.streamLayout", layoutId);
      localStorage.setItem(
        "streams",
        JSON.stringify(
          Array.from({ length: total }, (_, index) => ({
            id: `editor-${index}`,
            channel: `editor${index}`,
            platform: "kick",
          }))
        )
      );
    },
    { count, layout }
  );
  await page.reload();
}

const savedLayouts = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("custom-layouts") ?? "[]") as {
        id: string;
        name: string;
        slots: { x: number; y: number; w: number; h: number }[];
      }[]
  );

test("the layout editor opens from the picker, edits the shape and saves it", async ({
  page,
}, testInfo) => {
  // Arrange
  await seed(page, 4, "quad");

  // Act: open the editor from the button under "Save current grid"
  await page.getByTestId("layout-picker-btn").click();
  await page.getByTestId("layout-open-editor").click();
  const editor = page.getByTestId("layout-editor");
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("layout-editor-slot-3")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("editor-open.png") });

  // Act: drag the shared vertical line between the left and right tiles to the right
  await page.getByTestId("layout-editor-slot-0").click();
  const canvas = (await page.getByTestId("layout-editor-canvas").boundingBox())!;
  const edgeX = canvas.x + canvas.width / 2;
  const edgeY = canvas.y + canvas.height / 4;
  await page.mouse.move(edgeX, edgeY);
  await page.mouse.down();
  await page.mouse.move(edgeX + canvas.width * 0.1, edgeY, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: testInfo.outputPath("editor-dragged.png") });

  // Act: name it and save
  await page.getByTestId("layout-editor-name").fill("Wide left");
  await page.getByTestId("layout-editor-save-new").click();

  // Assert: saved, selected, and the left column is now ~60% wide with its neighbour following
  await expect(editor).not.toBeVisible();
  const saved = await savedLayouts(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]!.name).toBe("Wide left");
  const left = saved[0]!.slots[0]!;
  const right = saved[0]!.slots[1]!;
  expect(left.w).toBeCloseTo(0.6, 2);
  expect(right.x).toBeCloseTo(0.6, 2);
  expect(await page.evaluate(() => localStorage.getItem("preferences.streamLayout"))).toBe(
    saved[0]!.id
  );
  await page.screenshot({ path: testInfo.outputPath("grid-after-save.png") });

  // Act: edit it again from its pencil and add a PiP with the keyboard
  await page.getByTestId("layout-picker-btn").click();
  await page.getByTestId("layout-panel").hover();
  await page.getByTestId(`layout-edit-${saved[0]!.id}`).click();
  await expect(editor).toBeVisible();
  await page.getByTestId("layout-editor-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("p");
  await page.getByTestId("layout-editor-save").click();

  // Assert: same layout, now with five slots
  const updated = await savedLayouts(page);
  expect(updated).toHaveLength(1);
  expect(updated[0]!.id).toBe(saved[0]!.id);
  expect(updated[0]!.slots).toHaveLength(5);
});

test("closing with unsaved edits asks first", async ({ page }) => {
  // Arrange
  await seed(page, 2, "duo");
  await page.getByTestId("layout-picker-btn").click();
  await page.getByTestId("layout-open-editor").click();
  await page.getByTestId("layout-editor-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("p");

  // Act
  await page.getByTestId("layout-editor-close").click();

  // Assert
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByTestId("layout-editor-discard").click();
  await expect(page.getByTestId("layout-editor")).not.toBeVisible();
  expect(await savedLayouts(page)).toHaveLength(0);
});

test("maximize fills the whole grid and Esc puts it back", async ({ page }, testInfo) => {
  // Arrange
  await seed(page, 4, "quad");
  const item = page.getByTestId("stream-item-editor2");
  const grid = page.locator('[data-testid^="workspace-grid-"]').first();
  const before = (await item.boundingBox())!;
  const gridBox = (await grid.boundingBox())!;

  // Act
  await item.hover();
  await page.getByTestId("maximize-stream-editor2").click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: testInfo.outputPath("maximized.png") });

  // Assert: the tile covers the grid
  const max = (await item.boundingBox())!;
  expect(Math.round(max.width)).toBeGreaterThanOrEqual(Math.round(gridBox.width) - 2);
  expect(Math.round(max.height)).toBeGreaterThanOrEqual(Math.round(gridBox.height) - 2);

  // Act: the test page's player iframe keeps the keyboard focus (the desktop app forwards a
  // tile's Escape to the window instead), so hand focus back to the page first
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);

  // Assert: back in its own cell
  const after = (await item.boundingBox())!;
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  expect(Math.round(after.x)).toBe(Math.round(before.x));
});
