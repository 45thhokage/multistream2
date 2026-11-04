import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("Live now opens beside layouts and adds a discovered stream", async ({ page }) => {
  // Arrange
  if (process.env.MULTISTREAM_E2E_BUILD === "1") {
    await page.route("http://localhost/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const file = new URL(
        `../dist${pathname === "/" ? "/index.html" : pathname}`,
        import.meta.url
      );
      const contentType = pathname.endsWith(".js")
        ? "application/javascript"
        : pathname.endsWith(".css")
          ? "text/css"
          : "text/html";
      try {
        await route.fulfill({ body: await readFile(file), contentType });
      } catch {
        await route.fulfill({ status: 404, body: "" });
      }
    });
  }
  await page.route("https://player.twitch.tv/**", (route) =>
    route.fulfill({ body: "", contentType: "text/html" })
  );
  await page.addInitScript(() => {
    if (window !== window.top || sessionStorage.getItem("live-now-seeded")) return;
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    sessionStorage.setItem("live-now-seeded", "true");
  });
  await page.route("https://gql.twitch.tv/gql", async (route) => {
    const query = route.request().postData() || "";
    const edges = ["alpha", "bravo"].map((channel, index) => ({
      cursor: null,
      node: {
        broadcaster: { login: channel, broadcastSettings: { language: "en" } },
        title: `${channel} live`,
        viewersCount: 500 - index * 100,
        game: { displayName: "Music" },
      },
    }));
    await route.fulfill({
      json: { data: query.includes("streams(first:") ? { streams: { edges } } : {} },
    });
  });
  await page.route("https://kick.com/stream/featured-livestreams/**", (route) =>
    route.fulfill({ json: { data: [] } })
  );
  await page.goto("/");
  const layout = await page.getByTestId("layout-picker-btn").boundingBox();
  const live = await page.getByTestId("live-now-btn").boundingBox();
  expect(layout).not.toBeNull();
  expect(live).not.toBeNull();
  if (live && layout) expect(live.x).toBeGreaterThanOrEqual(layout.x + layout.width);

  // Act
  await page.getByTestId("live-now-btn").click();
  await page.getByTestId("live-now-platform-twitch").click();
  await page.getByTestId("live-now-search").fill("alpha");

  // Assert
  await expect(page.getByTestId("live-now-result-twitch-alpha")).toBeVisible();
  await expect(page.getByTestId("live-now-result-twitch-bravo")).toHaveCount(0);

  // Act
  await page.getByRole("button", { name: "Favorite alpha", exact: true }).click();
  await page.getByTestId("live-now-add-twitch-alpha").click();

  // Assert
  await expect(page.getByRole("button", { name: "Favorite alpha", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("live-now-add-twitch-alpha")).toBeDisabled();

  // Act
  await page.keyboard.press("Escape");

  // Assert
  await expect(page.getByTestId("live-now-panel")).toHaveCount(0);
  await expect(page.getByTestId("stream-item-alpha")).toBeVisible();
  await expect(page.getByTestId("layout-picker-btn")).toBeVisible();
});
