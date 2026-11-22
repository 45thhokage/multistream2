import { test, expect } from "@playwright/test";

const seed = async (page: import("@playwright/test").Page, tabbed: boolean) => {
  await page.goto("/");
  await page.evaluate((useTabs) => {
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    localStorage.setItem("preferences.followedSidebarOpen", "true");
    localStorage.setItem("preferences.tabbedSidebar", String(useTabs));
    localStorage.setItem(
      "favorites",
      JSON.stringify([
        {
          channel: "camsoda.com",
          platform: "custom",
          iframeUrl: "https://www.camsoda.com/abbey",
          displayName: "Abbey Room",
          siteUrl: "https://www.camsoda.com/abbey",
          addedAt: Date.now(),
        },
      ])
    );
  }, tabbed);
  await page.reload();
};

test("without the setting the sidebar is one merged list", async ({ page }) => {
  // Arrange
  await seed(page, false);

  // Assert
  await expect(page.getByTestId("sidebar-tabs")).toHaveCount(0);
  await expect(page.getByText("Abbey Room")).toBeVisible();
});

test("tabbed sidebar keeps Following apart from favorite sites, one section at a time", async ({
  page,
}) => {
  // Arrange
  await seed(page, true);

  // Assert: Following is the first section and holds no website favorites
  await expect(page.getByTestId("sidebar-tab-following")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Abbey Room")).toHaveCount(0);

  // Act
  await page.getByTestId("sidebar-tab-favorites").click();

  // Assert
  await expect(page.getByTestId("sidebar-tab-favorites")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Abbey Room")).toBeVisible();

  // Act: the chosen tab is remembered
  await page.reload();

  // Assert
  await expect(page.getByTestId("sidebar-tab-favorites")).toHaveAttribute("aria-selected", "true");
});
