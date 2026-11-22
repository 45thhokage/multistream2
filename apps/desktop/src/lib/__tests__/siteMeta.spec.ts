import { describe, it, expect } from "vitest";
import {
  displayHostname,
  ensureHttpUrl,
  siteFaviconForUrl,
  tileStartUrl,
  siteLabelForUrl,
  siteTitleForUrl,
} from "../siteMeta";

describe("siteMeta unit tests", () => {
  it("should normalize bare domains to https urls", () => {
    // Arrange
    const input = "github.com/ilanzgx";

    // Act
    const result = ensureHttpUrl(input);

    // Assert
    expect(result).toBe("https://github.com/ilanzgx");
  });

  it("should reject blank input and non-http protocols", () => {
    // Arrange
    const inputs = ["", "   ", "javascript:alert(1)", "file:///etc/passwd", "tauri://x"];

    // Act
    const results = inputs.map(ensureHttpUrl);

    // Assert
    expect(results).toEqual([null, null, null, null, null]);
  });

  it("should derive a stable site- label per url", () => {
    // Arrange
    const url = "https://github.com/";

    // Act
    const first = siteLabelForUrl(url);
    const second = siteLabelForUrl(url);
    const other = siteLabelForUrl("https://kick.com/");

    // Assert
    expect(first).toMatch(/^site-[a-z0-9]+$/);
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("should prefer an explicit title and fall back to hostname", () => {
    // Arrange
    const url = "https://www.github.com/ilanzgx";

    // Act
    const explicit = siteTitleForUrl(url, "  My Hub  ");
    const fallback = siteTitleForUrl(url);
    const garbage = siteTitleForUrl("not a url", undefined);

    // Assert
    expect(explicit).toBe("My Hub");
    expect(fallback).toBe("github.com");
    expect(garbage).toBe("not a url");
  });

  it("should build favicon urls from the site origin", () => {
    // Arrange
    const url = "https://github.com/ilanzgx/multistream";

    // Act
    const favicon = siteFaviconForUrl(url);
    const broken = siteFaviconForUrl("::::");

    // Assert
    expect(favicon).toBe("https://github.com/favicon.ico");
    expect(broken).toBe("");
  });

  it("should display bare hostnames without www prefix", () => {
    // Arrange
    const input = "www.redgifs.com/watch/abc";

    // Act
    const result = displayHostname(input);

    // Assert
    expect(result).toBe("redgifs.com");
  });
});

describe("tileStartUrl", () => {
  const original = "https://www.camsoda.com/";

  it("reopens on the page the live tile is on, not the URL it was added with", () => {
    // Act
    const url = tileStartUrl("https://www.camsoda.com/curvyjules69", undefined, original);

    // Assert
    expect(url).toBe("https://www.camsoda.com/curvyjules69");
  });

  it("falls back to the saved page after a restart, when there is no live tile", () => {
    // Act
    const url = tileStartUrl(null, "https://www.camsoda.com/curvyjules69", original);

    // Assert
    expect(url).toBe("https://www.camsoda.com/curvyjules69");
  });

  it("skips pages that are not http(s) and ends on the original URL", () => {
    // Act
    const url = tileStartUrl("about:blank", "javascript:alert(1)", original);

    // Assert
    expect(url).toBe(original);
  });
});
