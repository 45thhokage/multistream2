import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, tabbed: boolean) {
  await page.route("https://player.kick.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html><body>Test stream</body></html>" })
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.goto("/");
  await page.evaluate((useTabs) => {
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    localStorage.setItem("preferences.followedSidebarOpen", "true");
    localStorage.setItem("preferences.tabbedSidebar", String(useTabs));
    localStorage.setItem("preferences.sidebarTab", "presets");
    localStorage.setItem(
      "streams",
      JSON.stringify([
        { id: "s-1", channel: "first", platform: "kick" },
        { id: "s-2", channel: "second", platform: "kick" },
      ])
    );
    localStorage.setItem(
      "recents",
      JSON.stringify([
        { channel: "second", platform: "kick", addedAt: 2 },
        { channel: "first", platform: "kick", addedAt: 1 },
      ])
    );
  }, tabbed);
  await page.reload();
}

test("tabbed: seven icon tabs, only the active one named; presets save and add a lineup", async ({
  page,
}, testInfo) => {
  // Arrange
  await seed(page, true);
  const tabs = page.getByTestId("sidebar-tabs").getByRole("tab");

  // Assert: seven tabs, Presets active and the only one showing its name
  await expect(tabs).toHaveCount(7);
  await expect(page.getByTestId("sidebar-tab-presets")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("sidebar-tab-presets")).toContainText("Presets");
  await expect(page.getByTestId("sidebar-tab-history")).not.toContainText("History");

  // Act: save the two streams as a preset
  await page.getByTestId("preset-save").click();
  await page.getByTestId("preset-name").fill("Evening");
  await page.getByTestId("preset-save-confirm").click();

  // Assert
  await expect(page.getByTestId("preset-row-Evening")).toContainText("2");
  await page.screenshot({ path: testInfo.outputPath("tabbed-presets.png") });

  // Act: each tab shows its own section
  for (const id of ["streams", "layout", "following", "favorites", "history", "workspaces"]) {
    await page.getByTestId(`sidebar-tab-${id}`).click();
    await expect(page.getByTestId(`sidebar-pane-${id}`)).toBeVisible();
  }

  // Assert: history lists what was watched; workspaces can be added
  await page.getByTestId("sidebar-tab-history").click();
  await expect(page.getByTestId("history-row-second")).toBeVisible();
  await page.getByTestId("sidebar-tab-workspaces").click();
  await page.getByTestId("workspace-new-name").fill("Room B");
  await page.getByTestId("workspace-create").click();
  await expect(page.getByTestId("workspace-active")).toContainText("Room B");
  await page.screenshot({ path: testInfo.outputPath("tabbed-workspaces.png") });
});

test("stacked: every section in one column, folding on its own and all at once", async ({
  page,
}, testInfo) => {
  // Arrange
  await seed(page, false);
  const stack = page.getByTestId("sidebar-stack");

  // Assert: all seven, Workspaces folded by default
  await expect(stack.locator("[data-sidebar-section]")).toHaveCount(7);
  await expect(page.getByTestId("sidebar-section-toggle-workspaces")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await expect(page.getByTestId("sidebar-section-toggle-streams")).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  await page.screenshot({ path: testInfo.outputPath("stacked.png") });

  // Act: fold everything
  await page.getByTestId("sidebar-collapse-all").click();

  // Assert
  await expect(stack.locator('[aria-expanded="true"]')).toHaveCount(0);

  // Act: fold the sidebar, then pick History from the rail
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("sidebar-rail-history").click();

  // Assert: open again, with History unfolded
  await expect(page.getByTestId("sidebar-section-toggle-history")).toHaveAttribute(
    "aria-expanded",
    "true"
  );
});
