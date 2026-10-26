import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The in-process sweep schedule. It wakes at the module's own event times
// rather than on an interval, so the two things worth pinning are WHICH times
// it picks and that the chain can never die — a schedule that stops silently
// is the failure nobody notices until a month of reminders never went out.

const runSweep = vi.fn();
const readConfig = vi.fn();
vi.mock('../../lib/dailyReportScheduler', () => ({ runDailyReportSweep: (...a: unknown[]) => runSweep(...a) }));
vi.mock('../../lib/dailyReportConfigStore', () => ({ getDailyReportConfig: () => readConfig() }));

import { nextRunAt, startDailyReportAutoSweep, sweepClockTimes } from '../../lib/dailyReportAutoSweep';

const CONFIG = {
  final_reminder_time: '10:00',
  sales_auto_submit_time: '10:30',
  deadline_time: '11:30',
  evening_reminder_time: '21:00'
};

const OK = { status: 'ok', stats: { sent: {}, dryRun: false, failures: [] } };

beforeEach(() => {
  vi.useFakeTimers();
  runSweep.mockReset();
  runSweep.mockResolvedValue(OK);
  readConfig.mockReset();
  readConfig.mockResolvedValue(CONFIG);
  const existing = global.__nantaDailyReportSweepTimer;
  if (existing) clearTimeout(existing);
  global.__nantaDailyReportSweepTimer = undefined;
  process.env.NEXT_RUNTIME = 'nodejs';
  delete process.env.DAILY_REPORT_AUTO_SWEEP;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const existing = global.__nantaDailyReportSweepTimer;
  if (existing) clearTimeout(existing);
  global.__nantaDailyReportSweepTimer = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('which times the sweep wakes at', () => {
  it('takes all four event times from configuration, in order', () => {
    // 10:00 and 21:00 are the two that were asked for. 10:30 and 11:30 are
    // here because the sweep sends what is DUE when it runs — without them a
    // warning (11:30) and a sales auto-submit (10:30) would both wait until
    // 21:00.
    expect(sweepClockTimes(CONFIG)).toEqual(['10:00', '10:30', '11:30', '21:00']);
  });

  it('collapses two settings that fall on the same minute into one wake-up', () => {
    expect(sweepClockTimes({ ...CONFIG, sales_auto_submit_time: '10:00' })).toEqual(['10:00', '11:30', '21:00']);
  });

  it('follows the configuration when an admin moves a time', () => {
    expect(sweepClockTimes({ ...CONFIG, evening_reminder_time: '19:45' })).toEqual(['10:00', '10:30', '11:30', '19:45']);
  });

  it('ignores anything that is not a clock time', () => {
    expect(sweepClockTimes({ final_reminder_time: 'soon', deadline_time: '', evening_reminder_time: '21:00' })).toEqual(['21:00']);
    expect(sweepClockTimes({})).toEqual([]);
  });
});

describe('when the next wake-up falls', () => {
  // 2026-10-26T03:30:00Z is 09:00 IST.
  const at = (iso: string) => new Date(iso);

  it('picks the next time still to come today', () => {
    expect(nextRunAt(['10:00', '10:30', '11:30', '21:00'], at('2026-10-26T03:30:00Z'))!.toISOString())
      .toBe('2026-10-26T04:30:00.000Z'); // 10:00 IST
    // 04:45Z is 10:15 IST, so the next is 10:30.
    expect(nextRunAt(['10:00', '10:30', '11:30', '21:00'], at('2026-10-26T04:45:00Z'))!.toISOString())
      .toBe('2026-10-26T05:00:00.000Z'); // 10:30 IST
    // 05:15Z is 10:45 IST — past 10:30, so the next is 11:30.
    expect(nextRunAt(['10:00', '10:30', '11:30', '21:00'], at('2026-10-26T05:15:00Z'))!.toISOString())
      .toBe('2026-10-26T06:00:00.000Z'); // 11:30 IST
  });

  it('rolls to tomorrow once the day is done', () => {
    // 22:00 IST — past 21:00, so the next is 10:00 tomorrow.
    expect(nextRunAt(['10:00', '21:00'], at('2026-10-26T16:30:00Z'))!.toISOString())
      .toBe('2026-10-27T04:30:00.000Z');
  });

  it('is strictly after now, so a run at exactly 10:00 does not re-pick 10:00', () => {
    // Landing precisely on the minute must advance, or the chain spins.
    const exactly10 = at('2026-10-26T04:30:00Z');
    expect(nextRunAt(['10:00', '10:30'], exactly10)!.toISOString()).toBe('2026-10-26T05:00:00.000Z');
  });

  it('reads the day in IST, not UTC', () => {
    // 2026-10-26T19:30:00Z is already 01:00 IST on the 27th, so the next
    // 10:00 is the 27th's, not the 26th's.
    expect(nextRunAt(['10:00'], at('2026-10-26T19:30:00Z'))!.toISOString()).toBe('2026-10-27T04:30:00.000Z');
  });

  it('has nothing to schedule when there are no times', () => {
    expect(nextRunAt([], new Date())).toBeNull();
  });
});

describe('arming the schedule', () => {
  it('runs once shortly after boot, so a restart reconciles what it missed', async () => {
    startDailyReportAutoSweep();
    expect(runSweep).not.toHaveBeenCalled(); // never synchronously, during register()
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runSweep).toHaveBeenCalledTimes(1);
    expect(runSweep).toHaveBeenCalledWith({ trigger: 'auto' });
  });

  // In dev, Next re-evaluates modules on every hot reload. Without the latch
  // each reload left another live chain behind.
  it('arms exactly one chain however many times it is called', async () => {
    startDailyReportAutoSweep();
    startDailyReportAutoSweep();
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runSweep).toHaveBeenCalledTimes(1);
  });

  it('can be switched off for a deployment that uses a real scheduler', async () => {
    for (const value of ['off', 'false', '0', 'OFF']) {
      global.__nantaDailyReportSweepTimer = undefined;
      runSweep.mockClear();
      process.env.DAILY_REPORT_AUTO_SWEEP = value;
      startDailyReportAutoSweep();
      await vi.advanceTimersByTimeAsync(24 * 3600_000);
      expect(runSweep).not.toHaveBeenCalled();
    }
  });

  it('does nothing on a runtime that has no database or timers', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(runSweep).not.toHaveBeenCalled();
  });

  it('keeps the chain alive when a run throws', async () => {
    runSweep.mockRejectedValueOnce(new Error('connection dropped'));
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runSweep).toHaveBeenCalledTimes(1);
    // A full day later the chain must still be ticking, not dead.
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(runSweep.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps the chain alive when the configuration cannot be read', async () => {
    readConfig.mockRejectedValue(new Error('database is still starting'));
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    // Fell back to the default times rather than giving up.
    expect(runSweep.mock.calls.length).toBeGreaterThan(0);
  });

  it('does not hold the process open at shutdown', async () => {
    startDailyReportAutoSweep();
    await vi.advanceTimersByTimeAsync(0);
    const timer = global.__nantaDailyReportSweepTimer as unknown as { hasRef?: () => boolean };
    expect(timer.hasRef?.()).toBe(false);
  });
});
