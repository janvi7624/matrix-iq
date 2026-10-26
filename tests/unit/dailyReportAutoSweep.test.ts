import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The in-process sweep timer. Everything here is about the guards rather than
// the sweep itself: a timer that double-arms, holds the process open, or
// throws out of a tick is the sort of fault that only shows up in production
// at 3am, so each one is pinned.

const runSweep = vi.fn();
vi.mock('../../lib/dailyReportScheduler', () => ({ runDailyReportSweep: (...args: unknown[]) => runSweep(...args) }));

import { startDailyReportAutoSweep } from '../../lib/dailyReportAutoSweep';

const OK = { status: 'ok', stats: { sent: { REMINDER_EVENING: 2 }, dryRun: false, failures: [] } };

beforeEach(() => {
  vi.useFakeTimers();
  runSweep.mockReset();
  runSweep.mockResolvedValue(OK);
  // Each test starts with no timer armed.
  const existing = global.__nantaDailyReportSweepTimer;
  if (existing) clearInterval(existing);
  global.__nantaDailyReportSweepTimer = undefined;
  process.env.NEXT_RUNTIME = 'nodejs';
  delete process.env.DAILY_REPORT_AUTO_SWEEP;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const existing = global.__nantaDailyReportSweepTimer;
  if (existing) clearInterval(existing);
  global.__nantaDailyReportSweepTimer = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startDailyReportAutoSweep', () => {
  it('runs once shortly after boot, so a restart reconciles what it missed', async () => {
    startDailyReportAutoSweep();
    expect(runSweep).not.toHaveBeenCalled(); // not synchronously, during register()
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runSweep).toHaveBeenCalledTimes(1);
    expect(runSweep).toHaveBeenCalledWith({ trigger: 'auto' });
  });

  it('keeps sweeping every fifteen minutes', async () => {
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(30_000); // boot run
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(runSweep).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(45 * 60_000);
    expect(runSweep).toHaveBeenCalledTimes(5);
  });

  // In dev, Next re-evaluates modules on every hot reload. Without the global
  // latch each reload left another live interval behind, and after a dozen
  // edits the sweep was running twelve times a quarter hour.
  it('arms exactly one timer however many times it is called', async () => {
    startDailyReportAutoSweep();
    startDailyReportAutoSweep();
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(30_000 + 15 * 60_000);
    // One boot run + one interval run, not three of each.
    expect(runSweep).toHaveBeenCalledTimes(2);
  });

  it('can be switched off for a deployment that uses a real scheduler', async () => {
    for (const value of ['off', 'false', '0', 'OFF']) {
      global.__nantaDailyReportSweepTimer = undefined;
      runSweep.mockClear();
      process.env.DAILY_REPORT_AUTO_SWEEP = value;
      startDailyReportAutoSweep();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(runSweep).not.toHaveBeenCalled();
      expect(global.__nantaDailyReportSweepTimer).toBeUndefined();
    }
  });

  it('does nothing on a runtime that has no database or timers', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runSweep).not.toHaveBeenCalled();
  });

  // runDailyReportSweep is documented never to throw. If something under it
  // does anyway, the timer has to survive — swallowing the error is what
  // stops the next tick being the one that never comes.
  it('survives a tick that throws and keeps going', async () => {
    runSweep.mockRejectedValueOnce(new Error('connection dropped'));
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runSweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(runSweep).toHaveBeenCalledTimes(2);
  });

  it('does not hold the process open at shutdown', () => {
    startDailyReportAutoSweep();
    const timer = global.__nantaDailyReportSweepTimer as unknown as { hasRef?: () => boolean };
    // unref'd timers report hasRef() === false; a pending sweep must never be
    // a reason the server refuses to exit.
    expect(timer.hasRef?.()).toBe(false);
  });
});
