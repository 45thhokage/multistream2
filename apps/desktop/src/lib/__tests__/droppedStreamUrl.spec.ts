import { describe, expect, it } from "vitest";
import { droppedStreamUrl } from "../droppedStreamUrl";

describe("dropped links", () => {
  it("prefers browser link data and skips URI list comments", () => {
    // Arrange
    const data = {
      getData: (type: string) =>
        type === "text/uri-list" ? "# link\r\nhttps://twitch.tv/shroud" : "Link title",
    };
    // Act
    const result = droppedStreamUrl(data);
    // Assert
    expect(result).toMatchObject({ platform: "twitch", channel: "shroud" });
  });

  it.each([
    "javascript:alert(1)",
    "file:///C:/secret",
    "not a link",
    "https://a.test\nhttps://b.test",
  ])("rejects unsafe or ambiguous input %s", (text) => {
    // Arrange
    const data = { getData: (type: string) => (type === "text/plain" ? text : "") };
    // Act
    const result = droppedStreamUrl(data);
    // Assert
    expect(result).toBeNull();
  });
});
