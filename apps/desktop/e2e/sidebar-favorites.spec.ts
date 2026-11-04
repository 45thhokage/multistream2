import { test, expect } from "@playwright/test";

test.describe("Favorites & Recents E2E Test", () => {
  test.beforeEach(async ({ page }) => {
    // Arrange: set up localStorage with pre-populated favorites
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("locale", "en");
      localStorage.setItem("preferences.onboardingCompleted", "true");
      localStorage.setItem("preferences.sidebarOpen", "true");
      localStorage.setItem(
        "favorites",
        JSON.stringify([{ channel: "shroud", platform: "twitch", addedAt: Date.now() }])
      );
    });
    await page.reload();
  });

  test("favorites appear in AddDialog and can be quick-added to grid", async ({ page }) => {
    // Act: open AddDialog
    await page.getByTestId("add-stream-btn").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Assert: favorites section is visible with "shroud" inside dialog
    await expect(dialog.getByText("Favorites")).toBeVisible();
    const favoriteChip = dialog.getByTestId("stream-chip-twitch:shroud:");
    await expect(favoriteChip).toBeVisible();

    // Act: click favorite chip to quick-add
    await favoriteChip.click();

    // Assert: dialog closes and stream appears in grid
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("stream-item-shroud")).toBeVisible();
  });

  test("same-domain custom favorites coexist with favicons and quick-add separately", async ({
    page,
  }) => {
    // Arrange: seed two favorites sharing a domain but with distinct full urls
    await page.evaluate(() => {
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
            addedAt: Date.now(),
          },
          {
            channel: "github.com",
            platform: "custom",
            iframeUrl: "https://github.com/gorhill/",
            displayName: "gorhill",
            faviconUrl: "https://github.com/favicon.ico",
            siteUrl: "https://github.com/gorhill/",
            addedAt: Date.now(),
          },
        ])
      );
    });
    await page.reload();

    // Act: open AddDialog
    await page.getByTestId("add-stream-btn").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Assert: both favorites render as distinct chips with their favicons
    const ublockChip = dialog.getByTestId(
      "stream-chip-custom:github.com:https://github.com/gorhill/ublock"
    );
    const profileChip = dialog.getByTestId(
      "stream-chip-custom:github.com:https://github.com/gorhill/"
    );
    await expect(ublockChip).toBeVisible();
    await expect(profileChip).toBeVisible();
    await expect(ublockChip.getByText("uBlock Origin")).toBeVisible();
    await expect(profileChip.getByText("gorhill")).toBeVisible();
    await expect(ublockChip.getByRole("img", { name: "uBlock Origin" })).toHaveAttribute(
      "src",
      "https://github.com/favicon.ico"
    );
    await expect(profileChip.getByRole("img", { name: "gorhill" })).toHaveAttribute(
      "src",
      "https://github.com/favicon.ico"
    );

    // Act: quick-add the first favorite (dialog closes on quick-add)
    await ublockChip.click();
    await expect(dialog).not.toBeVisible();

    // Act: reopen and quick-add the second favorite
    await page.getByTestId("add-stream-btn").click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("stream-chip-custom:github.com:https://github.com/gorhill/").click();
    await expect(dialog).not.toBeVisible();

    // Assert: saving one url did not overwrite the other, both tiles are on the grid
    await expect(page.getByTestId("stream-item-github.com")).toHaveCount(2);
  });

  test("custom favorites appear in the followed sidebar and add to grid on click", async ({
    page,
  }) => {
    // Arrange: seed one custom favorite and open the followed sidebar
    await page.evaluate(() => {
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
            addedAt: Date.now(),
          },
        ])
      );
      localStorage.setItem("preferences.followedSidebarOpen", "true");
    });
    await page.reload();

    // Assert: the custom favorite shows up as a sidebar entry
    const entry = page.getByText("uBlock Origin");
    await expect(entry).toBeVisible();

    // Act: click the sidebar entry
    await entry.click();

    // Assert: the custom site lands on the grid
    await expect(page.getByTestId("stream-item-github.com")).toBeVisible();
  });
});
