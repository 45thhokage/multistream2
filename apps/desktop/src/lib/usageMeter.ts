export interface TileUsage {
  tileId: string;
  /** Bytes received since the tile opened. */
  bytes: number;
  /** Bytes received during the last tick. */
  delta: number;
}

/** Segments arrive in bursts, so rates are averaged over the last few ticks to stay readable. */
export const RATE_WINDOW_TICKS = 5;

export interface TileRate {
  /** Smoothed download speed in bytes per second. */
  rate: number;
  /** Bytes received since the tile opened. */
  bytes: number;
}

export interface UsageSnapshot {
  tiles: Record<string, TileRate>;
  /** Combined speed of every tile, in bytes per second. */
  rate: number;
  /** Bytes received by all tiles since the meter started. */
  sessionBytes: number;
}

/** Turns the per-tick byte deltas reported by the desktop backend into smoothed rates. */
export function createUsageMeter(windowTicks = RATE_WINDOW_TICKS) {
  const recent = new Map<string, number[]>();
  let sessionBytes = 0;
  // Bytes from tiles that have since closed still count towards the session.
  const closedBytes = new Map<string, number>();
  const openBytes = new Map<string, number>();

  return {
    ingest(tiles: readonly TileUsage[], intervalMs: number): UsageSnapshot {
      const seconds = Math.max(intervalMs, 1) / 1000;
      const seen = new Set<string>();
      const result: Record<string, TileRate> = {};
      let rate = 0;
      for (const tile of tiles) {
        seen.add(tile.tileId);
        const delta = Math.max(0, tile.delta);
        const window = recent.get(tile.tileId) ?? [];
        window.push(delta);
        if (window.length > windowTicks) window.shift();
        recent.set(tile.tileId, window);
        const tileRate = window.reduce((sum, value) => sum + value, 0) / (window.length * seconds);
        result[tile.tileId] = { rate: tileRate, bytes: tile.bytes };
        rate += tileRate;
        openBytes.set(tile.tileId, tile.bytes);
      }
      for (const id of recent.keys()) {
        if (seen.has(id)) continue;
        recent.delete(id);
        closedBytes.set(id, (closedBytes.get(id) ?? 0) + (openBytes.get(id) ?? 0));
        openBytes.delete(id);
      }
      sessionBytes = 0;
      for (const bytes of closedBytes.values()) sessionBytes += bytes;
      for (const bytes of openBytes.values()) sessionBytes += bytes;
      return { tiles: result, rate, sessionBytes };
    },
  };
}

/** Network speeds are conventionally shown in bits: "8.2 Mb/s", "925 kb/s". */
export function formatRate(bytesPerSecond: number): string {
  const bits = Math.max(0, bytesPerSecond) * 8;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mb/s`;
  return `${Math.round(bits / 1e3)} kb/s`;
}

export function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
  if (value >= 1e6) return `${Math.round(value / 1e6)} MB`;
  if (value >= 1e3) return `${Math.round(value / 1e3)} KB`;
  return `${Math.round(value)} B`;
}
