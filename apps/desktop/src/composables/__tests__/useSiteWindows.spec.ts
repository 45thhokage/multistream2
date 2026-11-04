import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useSiteWindows } from "../useSiteWindows";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/http";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  isTauri: vi.fn(),
}));

describe("useSiteWindows composable unit tests", () => {
  let sut: ReturnType<typeof useSiteWindows>;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(undefined);

    sut = useSiteWindows();
    for (const session of sut.sessions.value) {
      await sut.closeSite(session.label);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should open a site window and register the session", async () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000));

    // Act
    const session = await sut.openSite("github.com/ilanzgx", "My Hub");

    // Assert
    expect(session?.label).toMatch(/^site-/);
    expect(session?.url).toBe("https://github.com/ilanzgx");
    expect(session?.title).toBe("My Hub");
    expect(session?.faviconUrl).toBe("https://github.com/favicon.ico");
    expect(invoke).toHaveBeenCalledWith("open_site_window", {
      label: session?.label,
      url: "https://github.com/ilanzgx",
      title: "My Hub",
    });
    expect(sut.sessions.value.length).toBe(1);
  });

  it("should return null for invalid urls without invoking", async () => {
    // Arrange
    const bad = "javascript:alert(1)";

    // Act
    const session = await sut.openSite(bad);

    // Assert
    expect(session).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(sut.sessions.value.length).toBe(0);
  });

  it("should refocus an already open site instead of duplicating it", async () => {
    // Arrange
    vi.useFakeTimers();
    await sut.openSite("https://github.com");

    // Act
    await sut.openSite("https://github.com/");

    // Assert
    expect(sut.sessions.value.length).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("should close a session and invoke the backend command", async () => {
    // Arrange
    vi.useFakeTimers();
    const session = await sut.openSite("https://github.com");
    const label = session?.label ?? "";

    // Act
    await sut.closeSite(label);

    // Assert
    expect(invoke).toHaveBeenCalledWith("close_site_window", { label });
    expect(sut.sessions.value.length).toBe(0);
  });

  it("should drop stale sessions that are no longer open", async () => {
    // Arrange
    vi.useFakeTimers();
    const kept = await sut.openSite("https://github.com");
    await sut.openSite("https://kick.com");
    vi.mocked(invoke).mockResolvedValue([{ label: kept?.label, title: "GitHub" }]);

    // Act
    await sut.reconcile();

    // Assert
    expect(sut.sessions.value.map((s) => s.label)).toEqual([kept?.label]);
  });
});
