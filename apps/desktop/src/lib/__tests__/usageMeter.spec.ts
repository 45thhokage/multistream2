import { describe, expect, it } from "vitest";
import { createUsageMeter, formatBytes, formatRate } from "../usageMeter";

describe("formatRate", () => {
  it("shows bits per second like network tools do", () => {
    expect(formatRate(1_025_000)).toBe("8.2 Mb/s");
    expect(formatRate(115_625)).toBe("925 kb/s");
    expect(formatRate(0)).toBe("0 kb/s");
  });
});

describe("formatBytes", () => {
  it("picks a readable decimal unit", () => {
    expect(formatBytes(482_000)).toBe("482 KB");
    expect(formatBytes(800_400_000)).toBe("800 MB");
    expect(formatBytes(74_600_000_000)).toBe("74.6 GB");
    expect(formatBytes(512)).toBe("512 B");
  });
});

describe("createUsageMeter", () => {
  it("averages bursts over the window so the rate does not spike", () => {
    const meter = createUsageMeter(4);
    const tick = (delta: number, bytes: number) =>
      meter.ingest([{ tileId: "a", bytes, delta }], 1000);
    tick(0, 0);
    tick(0, 0);
    tick(0, 0);
    const burst = tick(4_000_000, 4_000_000);
    expect(burst.tiles.a?.rate).toBe(1_000_000);
    expect(burst.rate).toBe(1_000_000);
  });

  it("adds every tile into the total rate and session bytes", () => {
    const meter = createUsageMeter(1);
    const snapshot = meter.ingest(
      [
        { tileId: "a", bytes: 300, delta: 100 },
        { tileId: "b", bytes: 50, delta: 50 },
      ],
      1000
    );
    expect(snapshot.rate).toBe(150);
    expect(snapshot.sessionBytes).toBe(350);
  });

  it("keeps the bytes of a tile that closed in the session total", () => {
    const meter = createUsageMeter(1);
    meter.ingest(
      [
        { tileId: "a", bytes: 300, delta: 300 },
        { tileId: "b", bytes: 50, delta: 50 },
      ],
      1000
    );
    const snapshot = meter.ingest([{ tileId: "b", bytes: 80, delta: 30 }], 1000);
    expect(snapshot.sessionBytes).toBe(380);
    expect(snapshot.tiles.a).toBeUndefined();
  });

  it("does not count a reopened tile twice", () => {
    const meter = createUsageMeter(1);
    meter.ingest([{ tileId: "a", bytes: 300, delta: 300 }], 1000);
    meter.ingest([], 1000);
    const snapshot = meter.ingest([{ tileId: "a", bytes: 20, delta: 20 }], 1000);
    expect(snapshot.sessionBytes).toBe(320);
  });
});
