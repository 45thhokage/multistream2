import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, tabbed: boolean) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.goto("/");
  await page.evaluate((useTabs) => {
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    localStorage.setItem("preferences.followedSidebarOpen", "true");
    localStorage.setItem("preferences.tabbedSidebar", String(useTabs));
    localStorage.setItem("preferences.sidebarTab", "favorites");
    let at = 1;
    const fav = (channel: string, platform: string, extra = {}) => ({
      channel,
      platform,
      addedAt: at++,
      ...extra,
    });
    const favorites = [
      ...["desperatenasus", "solidfps", "xqc", "shroud"].map((c) => fav(c, "twitch")),
      ...["adinross", "trainwreck"].map((c) => fav(c, "kick")),
      fav("@RegularGuy", "youtube", { displayName: "Regular Guy", pinned: true }),
      ...Array.from({ length: 6 }, (_, i) =>
        fav(`camsoda model ${i}`, "custom", { iframeUrl: `https://www.camsoda.com/model${i}` })
      ),
      fav("www.tiktok.com", "custom", { iframeUrl: "https://www.tiktok.com/@someone" }),
    ];
    localStorage.setItem("favorites", JSON.stringify(favorites));
  }, tabbed);
  await page.reload();
}

test("the favorites panel searches, filters by site and keeps pinned favorites on top", async ({
  page,
}, testInfo) => {
  // Arrange
  await seed(page, false);
  const panel = page.getByTestId("favorites-panel");
  await expect(panel).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("stacked.png") });

  // Assert: chips for each site, camsoda.com with its own chip, Pinned group first
  await expect(page.getByTestId("favorites-chip-all")).toContainText("14");
  await expect(page.getByTestId("favorites-chip-twitch")).toContainText("4");
  await expect(page.getByTestId("favorites-chip-site:camsoda.com")).toContainText("6");
  await expect(page.getByTestId("favorites-group-pinned")).toContainText("1");

  // Act: one site
  await page.getByTestId("favorites-chip-kick").click();

  // Assert
  await expect(panel.locator('[data-testid^="favorite-row-"]')).toHaveCount(2);

  // Act: back to all, then search
  await page.getByTestId("favorites-chip-kick").click();
  await page.getByTestId("favorites-search").fill("solid");

  // Assert
  await expect(panel.locator('[data-testid^="favorite-row-"]')).toHaveCount(1);
  await expect(page.getByTestId("favorite-row-solidfps")).toBeVisible();
});

test("the tabbed sidebar shows one section at a time", async ({ page }, testInfo) => {
  // Arrange
  await seed(page, true);
  await expect(page.getByTestId("sidebar-tabs")).toBeVisible();

  // Assert: Favorites tab
  await expect(page.getByTestId("favorites-panel")).toBeVisible();
  await expect(page.getByTestId("stream-mixer")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("tabbed-favorites.png") });

  // Act
  await page.getByTestId("sidebar-tab-streams").click();

  // Assert
  await expect(page.getByTestId("stream-mixer")).toBeVisible();
  await expect(page.getByTestId("favorites-panel")).toHaveCount(0);

  // Act
  await page.getByTestId("sidebar-tab-following").click();

  // Assert
  await expect(page.getByTestId("stream-mixer")).toHaveCount(0);
  await expect(page.getByTestId("favorites-panel")).toHaveCount(0);
});
