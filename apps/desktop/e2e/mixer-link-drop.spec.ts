import { expect, test } from "@playwright/test";

test("browser preview keeps native mute disabled and replaces a dropped link", async ({ page }) => {
  // Arrange
  await page.addInitScript(() => {
    if (window !== window.top) return;
    if (sessionStorage.getItem("mixer-test-seeded")) return;
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    localStorage.setItem("preferences.followedSidebarOpen", "true");
    localStorage.setItem(
      "streams",
      JSON.stringify([
        { id: "first", channel: "shroud", platform: "twitch" },
        { id: "second", channel: "xqc", platform: "kick" },
      ])
    );
    sessionStorage.setItem("mixer-test-seeded", "true");
  });
  await page.goto("/");
  const channel = page.getByTestId("mixer-channel-shroud");

  // Assert
  await expect(channel.getByRole("button", { name: "Solo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("mixer-native-required")).toBeVisible();

  // Act
  await page.getByTestId("stream-item-shroud").evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/uri-list", "https://www.youtube.com/watch?v=abcdef12345");
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });

  // Assert
  await expect(page.getByTestId("stream-item-abcdef12345")).toBeVisible();
  await expect(page.getByTestId("stream-item-xqc")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("streams") ?? "[]").map(
          (stream: { channel: string }) => stream.channel
        )
      )
    )
    .toEqual(["abcdef12345", "xqc"]);

  // Act
  await page.locator("main").evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", "javascript:alert(1)");
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });

  // Assert
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("streams") ?? "[]").length)
  ).toBe(2);
});
