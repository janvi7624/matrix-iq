'use client';

import { useEffect, useRef } from 'react';

// Keeps a page's data current without reloading the page.
//
// Two triggers, deliberately in this order of importance:
//
//   1. The tab regaining focus. This is the case that actually matters — you
//      switch to WhatsApp or another tab, come back, and want today's numbers.
//      It costs exactly one fetch per return and nothing at all while idle.
//   2. A slow interval, PAUSED whenever the tab is hidden. Someone watching
//      the dashboard sees it tick over; the twenty people who left it open on
//      a second monitor cost nothing.
//
// What this deliberately is NOT: a short timer, and never location.reload().
//
// Reloading the page would throw away whatever the person was doing — a
// half-filled New Project form, an open dialog, the remark prompt, their
// filters, their scroll position. On a shared dashboard somebody is always
// mid-task. This refetches DATA only, so all of that survives.
//
// And the cadence has to stay slow because of a hard limit: the app's database
// role (matrixiq_vps) is capped at 20 connections, while Sequelize's pool is
// max 10 per Node process — so a single process can take half the budget, and
// "too many connections for role matrixiq_vps" is already an error this app
// hits in normal use. These pages are not cheap either: the project list
// resolves last_remark with a DISTINCT ON across the whole timeline table, and
// department scoring is several hundred lines of aggregation. Multiply that by
// 45 active users on a few seconds' timer and the refresh is the outage.

/** Default cadence. Matches NotificationBell, which has polled at 60s for a while. */
export const DEFAULT_REFRESH_MS = 60_000;

/**
 * The shortest gap allowed between two refreshes, whatever asks for one.
 * Alt-tabbing back and forth fires `focus` every time; this is what stops that
 * becoming a burst of identical queries.
 */
export const MIN_REFRESH_GAP_MS = 10_000;

/**
 * Whether a refresh should actually run now. Pure so it can be tested without
 * a DOM — the hook below is the only thing that touches window/document.
 *
 * @param lastAt  epoch ms of the last refresh, or 0 if none has run yet
 * @param now     epoch ms
 */
export function shouldRefresh(lastAt: number, now: number, minGapMs: number = MIN_REFRESH_GAP_MS): boolean {
  if (!lastAt) return true;
  // A clock that moved backwards (manual change, DST, a suspended laptop
  // resuming) would otherwise compute a negative gap and block refreshes until
  // real time caught up. Treat it as "long enough ago".
  if (now < lastAt) return true;
  return now - lastAt >= minGapMs;
}

export interface AutoRefreshOptions {
  /** Interval while the tab is visible. 0 or negative disables the interval, leaving focus-only. */
  intervalMs?: number;
  /** Set false to suspend entirely — e.g. while a dialog is open, or a form is dirty. */
  enabled?: boolean;
  /** Minimum gap between refreshes, shared by both triggers. */
  minGapMs?: number;
}

/**
 * Calls `refresh` when the tab regains focus, and on a slow interval while it
 * is visible. Never reloads the page.
 *
 * `refresh` may be recreated on every render (the usual case for a `load()`
 * defined in a component body) — it is held in a ref, so the listeners are
 * registered once rather than torn down and rebuilt each render.
 */
export function useAutoRefresh(refresh: () => void | Promise<void>, options: AutoRefreshOptions = {}): void {
  const { intervalMs = DEFAULT_REFRESH_MS, enabled = true, minGapMs = MIN_REFRESH_GAP_MS } = options;

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const lastAtRef = useRef(0);
  // Guards against overlap: a slow query must not have a second copy of itself
  // started on top of it by the next tick or a tab switch.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const run = async () => {
      if (cancelled || inFlightRef.current) return;
      const now = Date.now();
      if (!shouldRefresh(lastAtRef.current, now, minGapMs)) return;
      lastAtRef.current = now;
      inFlightRef.current = true;
      try {
        await refreshRef.current();
      } catch {
        // Swallowed on purpose. A background refresh that fails must not
        // surface an error over whatever the person is reading — the data they
        // already have stays on screen, and the next trigger tries again.
      } finally {
        inFlightRef.current = false;
      }
    };

    // Seeded as "just refreshed": every caller mounts right after its own
    // initial load, so without this the first focus event would immediately
    // fetch the same data a second time.
    lastAtRef.current = Date.now();

    const onFocus = () => {
      void run();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    // Checked per tick rather than by starting/stopping the timer on
    // visibilitychange: one timer for the component's life is simpler to
    // reason about than one whose existence depends on event ordering, and a
    // tick that returns early costs nothing.
    const timer =
      intervalMs > 0
        ? window.setInterval(() => {
            if (document.visibilityState === 'visible') void run();
          }, intervalMs)
        : 0;

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) window.clearInterval(timer);
    };
  }, [enabled, intervalMs, minGapMs]);
}
