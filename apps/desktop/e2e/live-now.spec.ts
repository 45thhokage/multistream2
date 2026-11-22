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
  await page.route("https://kick.com/stream/**", (route) => route.fulfill({ json: { data: [] } }));
  await page.goto("/");
  const layout = await page.getByTestId("layout-picker-btn").boundingBox();
  const live = await page.getByTestId("live-now-btn").boundingBox();
  expect(layout).not.toBeNull();
  expect(live).not.toBeNull();
  if (live && layout) expect(live.x).toBeGreaterThanOrEqual(layout.x + layout.width);

  // Act
  await page.getByTestId("live-now-btn").click();
  await page.getByTestId("live-now-platform-twitch").click();
  await page.getByRole("textbox", { name: "Filter loaded channels and titles" }).fill("alpha");

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
  await page
    .getByTestId("live-now-browser")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  // Assert
  await expect(
    page.getByRole("textbox", { name: "Filter loaded channels and titles" })
  ).toHaveValue("alpha");
  await expect(page.getByTestId("stream-item-alpha")).toBeVisible();
  // Act
  await page.keyboard.press("Escape");

  // Assert
  await expect(page.getByTestId("live-now-panel")).toHaveCount(0);
  await expect(page.getByTestId("stream-item-alpha")).toBeVisible();
  await expect(page.getByTestId("layout-picker-btn")).toBeVisible();
});

test("Directory pagination, remote categories and offline favorites remain independent", async ({
  page,
}) => {
  // Arrange
  await page.route("http://localhost/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const file = new URL(`../dist${pathname === "/" ? "/index.html" : pathname}`, import.meta.url);
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: pathname.endsWith(".js")
          ? "application/javascript"
          : pathname.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
  });
  await page.route("https://kick.com/**", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("https://gql.twitch.tv/gql", async (route) => {
    const query = route.request().postDataJSON()?.query || "";
    if (query.includes("index: CHANNEL")) {
      await route.fulfill({
        json: {
          data: {
            searchFor: {
              channels: { items: [{ login: "offline", stream: null }, { login: "unknown" }] },
            },
          },
        },
      });
      return;
    }
    if (query.includes("games(first:") || query.includes("index: GAME")) {
      await route.fulfill({
        json: {
          data: {
            searchFor: {
              games: {
                items: [{ id: "rare", name: "Rare category", displayName: "Rare category" }],
              },
            },
          },
        },
      });
      return;
    }
    const category = query.includes("game(id:");
    const second = query.includes("after:");
    const connection = {
      edges: [
        {
          cursor: "one",
          node: {
            broadcaster: { login: category ? "rarelive" : second ? "beta" : "alpha" },
            title: "Live broadcast",
            viewersCount: 0,
            game: { displayName: category ? "Rare category" : "Music" },
          },
        },
      ],
      pageInfo: { hasNextPage: !category && !second },
    };
    await route.fulfill({
      json: { data: category ? { game: { streams: connection } } : { streams: connection } },
    });
  });
  await page.goto("/");
  await page.getByTestId("live-now-btn").click();
  await page.getByTestId("live-now-platform-twitch").click();
  await expect(page.getByTestId("live-now-result-twitch-alpha")).toBeVisible();
  // Act
  await page
    .getByRole("textbox", { name: "Filter loaded channels and titles" })
    .fill("nothing matches");
  await page.getByTestId("live-now-load-more").click();
  // Assert
  await expect(
    page.getByText("Loaded results only: 0 matching / 2 loaded", { exact: true })
  ).toBeVisible();
  // Act
  await page.getByRole("textbox", { name: "Filter loaded channels and titles" }).fill("");
  await page.getByTestId("live-now-search").fill("offline");
  await page.getByTestId("live-now-search").press("Enter");
  await expect(page.getByTestId("live-now-result-twitch-offline")).toBeVisible();
  await page.getByRole("button", { name: "Favorite offline", exact: true }).click();
  // Assert
  await expect(page.getByRole("button", { name: "Favorite offline", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(
    page.getByTestId("live-now-result-twitch-unknown").getByText("Unknown", { exact: true }).last()
  ).toBeVisible();
  // Act
  await page.getByTestId("live-now-search").fill("");
  await page.getByTestId("live-now-browse-categories").click();
  await page.getByTestId("live-now-category-search").fill("Rare");
  await page.getByRole("button", { name: "Rare category", exact: true }).click();
  await page
    .getByTestId("live-now-browser")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  // Assert
  await expect(page.getByTestId("live-now-result-twitch-rarelive")).toBeVisible();
  await expect(page.getByTestId("live-now-clear-category")).toBeVisible();
  await page.screenshot({ path: "test-results/live-now-categories.png" });
});

test("YouTube topic continuation opens the selected broadcast and favorites its channel", async ({
  page,
}) => {
  // Arrange
  await page.route("http://localhost/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    try {
      await route.fulfill({
        body: await readFile(
          new URL(`../dist${pathname === "/" ? "/index.html" : pathname}`, import.meta.url)
        ),
        contentType: pathname.endsWith(".js")
          ? "application/javascript"
          : pathname.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({ body: "", contentType: "text/html" })
  );
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    localStorage.setItem("live-now-provider", "youtube");
  });
  await page.goto("/");
  await expect(page.getByTestId("live-now-btn")).toBeVisible();
  await page.evaluate(() => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "youtube_search_live") {
          const video = args.cursor ? "video222222" : "video111111";
          return {
            items: [
              {
                channel: video,
                handle: "samechannel",
                displayName: "Same Channel",
                platform: "youtube",
                title: "Music live",
                category: "",
                status: "live",
              },
            ],
            cursor: args.cursor ? undefined : "continuation",
          };
        }
        if (command === "youtube_search_channels" || command === "youtube_check_channels_status")
          return [];
        if (command === "youtube_resolve_live_id")
          throw Error("Broadcast IDs must not resolve through a channel");
        throw Error("Unmocked command");
      },
    };
  });
  // Act
  await page.getByTestId("live-now-btn").click();
  await page.getByTestId("live-now-search").fill("music");
  await page.getByTestId("live-now-search").press("Enter");
  await expect(page.getByTestId("live-now-result-youtube-video111111")).toBeVisible();
  await page.getByTestId("live-now-load-more").click();
  await page
    .getByTestId("live-now-result-youtube-video222222")
    .getByRole("button", { name: "Favorite Same Channel", exact: true })
    .click();
  await page.getByTestId("live-now-add-youtube-video222222").click();
  // Assert
  await expect(page.getByTestId("stream-item-video222222")).toBeVisible();
  await expect(page.getByTestId("stream-item-video111111")).toHaveCount(0);
  await expect(page.getByTestId("live-now-add-youtube-video222222")).toBeDisabled();
  await expect(page.getByTestId("live-now-add-youtube-video111111")).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("favorites"))).toContain("samechannel");
});

test("Twitch browses successive category pages and filters streams with tag chips", async ({
  page,
}) => {
  // Arrange
  await page.route("http://localhost/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    try {
      await route.fulfill({
        body: await readFile(
          new URL(`../dist${pathname === "/" ? "/index.html" : pathname}`, import.meta.url)
        ),
        contentType: pathname.endsWith(".js")
          ? "application/javascript"
          : pathname.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("locale", "en");
    localStorage.setItem("preferences.onboardingCompleted", "true");
    localStorage.setItem("live-now-provider", "twitch");
  });
  const directoryRequests: string[] = [];
  await page.route("https://gql.twitch.tv/gql", async (route) => {
    const query = route.request().postDataJSON()?.query || "";
    if (query.includes("games(first:")) {
      const second = query.includes("after:");
      const edges = Array.from({ length: 30 }, (_, index) => {
        const id = index + (second ? 30 : 0);
        return {
          cursor: second ? "last" : "category-next",
          node: {
            id: `cat${id}`,
            name: `Category ${id}`,
            displayName: id === 35 ? "Just Chatting" : `Category ${id}`,
            viewersCount: 1000 - id,
          },
        };
      });
      await route.fulfill({
        json: { data: { games: { edges, pageInfo: { hasNextPage: !second } } } },
      });
      return;
    }
    if (query.includes("streams(first:")) {
      directoryRequests.push(query);
      const connection = {
        edges: ["alpha", "beta"].map((login, index) => ({
          cursor: "stream-next",
          node: {
            broadcaster: { login },
            title: `${login} title`,
            game: { displayName: "Just Chatting" },
            viewersCount: index,
            freeformTags: (index
              ? ["Comedy"]
              : [
                  "ADHD",
                  "Anime",
                  "based",
                  "Battlegrounds",
                  "chill",
                  "chocolate",
                  "Comedy",
                  "Cycling",
                  "Dance",
                  "DEO",
                  "DFM",
                  "DropsEnabled",
                  "English",
                  "French",
                  "Gaming",
                  "Music",
                  "Portuguese",
                  "RPG",
                ]
            ).map((name) => ({ name })),
          },
        })),
        pageInfo: { hasNextPage: true },
      };
      await route.fulfill({
        json: {
          data: query.includes("game(id:")
            ? { game: { streams: connection } }
            : { streams: connection },
        },
      });
      return;
    }
    await route.fulfill({ json: { data: {} } });
  });
  await page.goto("/");
  await page.getByTestId("live-now-btn").click();
  // Act
  await page.getByTestId("live-now-browse-categories").click();
  await expect(page.getByTestId("live-now-category-cat29")).toBeVisible();
  await page.getByTestId("live-now-category-cat29").scrollIntoViewIfNeeded();
  await page.getByTestId("live-now-category-cat35").scrollIntoViewIfNeeded();
  // Assert
  await expect(page.getByTestId("live-now-category-cat35")).toBeVisible();
  await expect(page.getByTestId("live-now-result-twitch-alpha")).toHaveCount(0);
  await page.screenshot({ path: "test-results/live-now-twitch-category-list.png" });
  // Act
  await page.getByTestId("live-now-category-cat35").click();
  const chips = page.getByTestId("live-now-loaded-tags");
  await chips.getByRole("button", { name: "ADHD", exact: true }).click();
  // Assert
  await expect(chips.getByRole("button", { name: "ADHD", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("live-now-result-twitch-alpha")).toBeVisible();
  await expect(page.getByTestId("live-now-result-twitch-beta")).toHaveCount(0);
  expect(directoryRequests.at(-1)).toContain('game(id: "cat35")');
  const title = await page
    .getByRole("heading", { name: "Just Chatting", exact: true })
    .boundingBox();
  const filter = await page.getByTestId("live-now-loaded-search").boundingBox();
  expect(title && filter && filter.x > title.x && Math.abs(filter.y - title.y) < 24).toBeTruthy();
  await page.screenshot({ path: "test-results/live-now-twitch-tag-chips.png" });
  await page.setViewportSize({ width: 1000, height: 720 });
  const panel = page.getByTestId("live-now-content");
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/live-now-twitch-tags-narrow.png" });
  // Act
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await page.getByRole("button", { name: "Clear tags", exact: true }).click();
  await page
    .getByTestId("live-now-saved-filters")
    .getByRole("button", { name: "ADHD", exact: true })
    .click();
  await expect(chips.getByRole("button", { name: "ADHD", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("button", { name: "Clear tags", exact: true }).click();
  await page.getByTestId("live-now-loaded-search").fill("beta");
  // Assert
  await expect(page.getByTestId("live-now-result-twitch-beta")).toBeVisible();
  await expect(page.getByTestId("live-now-result-twitch-alpha")).toHaveCount(0);
  // Act
  await page.getByTestId("live-now-directory-tag").fill("English, DropsEnabled");
  await page.getByTestId("live-now-apply-tag").click();
  // Assert
  await expect(page.getByRole("button", { name: "Remove tag English", exact: true })).toBeVisible();
  expect(directoryRequests.at(-1)).toContain('freeformTags: ["English","DropsEnabled"]');
  // Act
  await page.getByTestId("live-now-back-categories").click();
  await expect(page.getByTestId("live-now-category-cat35")).toBeAttached();
  await page.getByTestId("live-now-back-streams").click();
  await page.getByTestId("live-now-clear-category").click();
  // Assert
  await expect(page.getByTestId("live-now-browse-categories")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Just Chatting", exact: true })).toHaveCount(0);
  // Act
  await page.getByTestId("live-now-platform-kick").click();
  // Assert
  await expect(page.getByTestId("live-now-browse-categories")).toHaveCount(0);
});
