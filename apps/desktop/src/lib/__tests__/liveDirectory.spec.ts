import { afterEach, describe, expect, it, vi } from "vitest";
import { categoryPage, directoryPage } from "../liveDirectory";
import { httpGet, httpPost } from "../http";
vi.mock("../http", () => ({ httpGet: vi.fn(), httpPost: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.clearAllMocks());
describe("Live directory transport", () => {
  it("passes Twitch tags, category and opaque cursor and preserves zero viewers", async () => {
    // Arrange
    vi.mocked(httpPost).mockResolvedValue(
      Response.json({
        data: {
          game: {
            streams: {
              edges: [
                { cursor: "next", node: { broadcaster: { login: "alice" }, viewersCount: 0 } },
              ],
              pageInfo: { hasNextPage: true },
            },
          },
        },
      })
    );
    // Act
    const page = await directoryPage("twitch", "opaque", "Rare category", ["English"]);
    // Assert
    const query = JSON.parse(vi.mocked(httpPost).mock.calls[0]![1]).query;
    expect(query).toContain('after: "opaque"');
    expect(query).toContain('game(id: "Rare category")');
    expect(query).toContain('freeformTags: ["English"]');
    expect(page.items[0]?.viewerCount).toBe(0);
    expect(page.cursor).toBe("next");
  });
  it("uses Kick's canonical category slug and page metadata", async () => {
    // Arrange
    vi.mocked(httpGet)
      .mockResolvedValueOnce(
        Response.json({ categories: [{ name: "Rare name", slug: "canonical-slug" }] })
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ channel: { slug: "alice" } }], next_page_url: "next" })
      );
    // Act
    const categories = await categoryPage("kick", "Rare");
    const page = await directoryPage("kick", "2", categories.items[0]?.id);
    // Assert
    expect(vi.mocked(httpGet).mock.calls[1]?.[0]).toContain("subcategory=canonical-slug");
    expect(page.cursor).toBe("3");
    expect(page.items[0]?.viewerCount).toBeUndefined();
  });
  it("keeps provider errors distinct from successful empty pages", async () => {
    // Arrange
    vi.mocked(httpPost).mockResolvedValue(Response.json({ errors: [{ message: "Unavailable" }] }));
    // Act
    const request = directoryPage("twitch");
    // Assert
    await expect(request).rejects.toThrow("Unavailable");
  });
  it("returns category artwork, viewer counts and the next category cursor", async () => {
    // Arrange
    vi.mocked(httpPost).mockResolvedValue(
      Response.json({
        data: {
          games: {
            edges: [
              {
                cursor: "next-categories",
                node: {
                  id: "743",
                  name: "Chess",
                  displayName: "Chess",
                  viewersCount: 0,
                  boxArtURL: "https://example.test/chess.jpg",
                },
              },
            ],
            pageInfo: { hasNextPage: true },
          },
        },
      })
    );
    // Act
    const page = await categoryPage("twitch", "", "previous-categories");
    // Assert
    expect(page.cursor).toBe("next-categories");
    expect(page.items[0]).toEqual({
      id: "743",
      name: "Chess",
      viewerCount: 0,
      artwork: "https://example.test/chess.jpg",
    });
    expect(JSON.parse(vi.mocked(httpPost).mock.calls[0]![1]).query).toContain(
      'after: "previous-categories"'
    );
  });
});
