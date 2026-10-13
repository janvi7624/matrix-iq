import { describe, it, expect } from 'vitest';
import { DEFAULT_REFRESH_MS, MIN_REFRESH_GAP_MS, shouldRefresh } from '../../lib/useAutoRefresh';

// The hook itself wires window/document events and cannot run here (this suite
// has no DOM — there is no vitest environment configured). The throttle
// decision is the part with actual logic in it, so it lives as a pure function
// and is pinned here.
//
// Why the throttle matters: the database role is capped at 20 connections and
// Sequelize's pool is max 10 per process, so repeated refreshes are not free.
// Alt-tabbing fires `focus` every single time.

const T = 1_000_000;

describe('shouldRefresh', () => {
  it('allows the very first refresh, whatever the clock says', () => {
    expect(shouldRefresh(0, T)).toBe(true);
    expect(shouldRefresh(0, 0)).toBe(true);
  });

  it('blocks a second refresh inside the minimum gap', () => {
    expect(shouldRefresh(T, T + 1)).toBe(false);
    expect(shouldRefresh(T, T + MIN_REFRESH_GAP_MS - 1)).toBe(false);
  });

  it('allows one exactly at the gap, and after', () => {
    expect(shouldRefresh(T, T + MIN_REFRESH_GAP_MS)).toBe(true);
    expect(shouldRefresh(T, T + MIN_REFRESH_GAP_MS + 1)).toBe(true);
  });

  it('honours a caller-supplied gap over the default', () => {
    expect(shouldRefresh(T, T + 500, 1000)).toBe(false);
    expect(shouldRefresh(T, T + 1000, 1000)).toBe(true);
  });

  // A laptop resuming from sleep, a manual clock change or a DST shift can put
  // `now` behind the recorded time. Subtracting would give a negative gap and
  // block every refresh until real time caught up — potentially hours.
  it('treats a clock that moved backwards as long enough ago', () => {
    expect(shouldRefresh(T, T - 1)).toBe(true);
    expect(shouldRefresh(T, T - 60 * 60 * 1000)).toBe(true);
  });

  it('throttles a burst of focus events down to one refresh', () => {
    let last = 0;
    let refreshes = 0;
    // Someone alt-tabbing in and out ten times over two seconds.
    for (let i = 0; i < 10; i += 1) {
      const now = T + i * 200;
      if (shouldRefresh(last, now)) {
        refreshes += 1;
        last = now;
      }
    }
    expect(refreshes).toBe(1);
  });

  it('lets a genuinely later return through', () => {
    let last = 0;
    let refreshes = 0;
    for (const now of [T, T + 2_000, T + 30_000, T + 31_000, T + 90_000]) {
      if (shouldRefresh(last, now)) {
        refreshes += 1;
        last = now;
      }
    }
    // T (first), +30s (gap cleared), +90s (gap cleared). The two near-misses
    // are thrown away.
    expect(refreshes).toBe(3);
  });
});

describe('cadence constants', () => {
  it('polls no faster than once a minute', () => {
    expect(DEFAULT_REFRESH_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('keeps a floor between refreshes that is well short of the interval', () => {
    expect(MIN_REFRESH_GAP_MS).toBeGreaterThan(0);
    expect(MIN_REFRESH_GAP_MS).toBeLessThan(DEFAULT_REFRESH_MS);
  });
});
