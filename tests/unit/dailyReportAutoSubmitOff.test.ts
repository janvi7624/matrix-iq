import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sales reports are submitted by the rep, not by the system.
//
// The module used to auto-file a Sales/GEM-Sales report at 10:30 the next
// working morning if the rep had not submitted. That was removed as a policy
// decision (2026-10-29): a report the system wrote on your behalf is not a
// report you wrote. The switch is `sales_auto_submit_time` — blank means off,
// and blank is now the default.
//
// What these pin:
//   1. the default really is off, so a fresh install never auto-files;
//   2. blank survives a config update instead of being coerced back to a
//      time, and a malformed value reads as off rather than being guessed;
//   3. the cron stops waking up for an auto-submit that will never happen.
//
// What is deliberately NOT changed, and must not be: the auto-FETCHED
// figures. Those are merged into the report on read (dailyReportService) and
// refreshed on every save and submit (dailyReportStore), both independent of
// this switch — the rep opens a report with the system's numbers already in
// it and presses submit themselves.

const m = vi.hoisted(() => ({ findOne: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() }));
vi.mock('../../lib/db', () => ({
  db: {
    // count() is what ensureRow() calls before any update.
    DailyReportConfig: { findOne: m.findOne, create: m.create, update: m.update, count: m.count },
    User: { findOne: vi.fn(), findByPk: vi.fn() }
  },
  isUuid: () => true,
  sequelize: { query: vi.fn() }
}));

import { DEFAULT_DAILY_REPORT_CONFIG, InvalidDailyReportConfigError, updateDailyReportConfig } from '../../lib/dailyReportConfigStore';
import { sweepClockTimes } from '../../lib/dailyReportAutoSweep';
import { mergeAutoMatrix } from '../../lib/salesDailyAutoFetch';

/** A config row that remembers what was written to it. */
function rowStub(initial: Record<string, unknown>) {
  const state: Record<string, unknown> = { id: 'cfg-1', ...initial };
  return {
    state,
    row: {
      get: (opts?: unknown) => (opts ? { ...state } : { ...state }),
      update: async (attrs: Record<string, unknown>) => {
        Object.assign(state, attrs);
        return { get: () => ({ ...state }) };
      }
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.count.mockResolvedValue(1); // the singleton config row already exists
});

describe('the default', () => {
  it('ships with Sales auto-submit off', () => {
    expect(DEFAULT_DAILY_REPORT_CONFIG.sales_auto_submit_time).toBe('');
  });

  it('still ships the event times the module cannot run without', () => {
    // Guards against "off by default" being read as "blank everything".
    expect(DEFAULT_DAILY_REPORT_CONFIG.deadline_time).toMatch(/^\d{2}:\d{2}$/);
    expect(DEFAULT_DAILY_REPORT_CONFIG.evening_reminder_time).toMatch(/^\d{2}:\d{2}$/);
    expect(DEFAULT_DAILY_REPORT_CONFIG.final_reminder_time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('updating the switch', () => {
  it('accepts blank, and keeps it blank', async () => {
    const { state, row } = rowStub({ sales_auto_submit_time: '10:30' });
    m.findOne.mockResolvedValue(row);
    await updateDailyReportConfig({ sales_auto_submit_time: '' }, null);
    expect(state.sales_auto_submit_time).toBe('');
  });

  it('treats a whitespace-only value as blank rather than invalid', async () => {
    const { state, row } = rowStub({ sales_auto_submit_time: '10:30' });
    m.findOne.mockResolvedValue(row);
    await updateDailyReportConfig({ sales_auto_submit_time: '   ' }, null);
    expect(state.sales_auto_submit_time).toBe('');
  });

  it('still accepts a real time, so this is reversible without a deploy', async () => {
    const { state, row } = rowStub({ sales_auto_submit_time: '' });
    m.findOne.mockResolvedValue(row);
    await updateDailyReportConfig({ sales_auto_submit_time: '10:45' }, null);
    expect(state.sales_auto_submit_time).toBe('10:45');
  });

  it('rejects a malformed time instead of silently switching auto-submit on', async () => {
    const { row } = rowStub({ sales_auto_submit_time: '' });
    m.findOne.mockResolvedValue(row);
    await expect(updateDailyReportConfig({ sales_auto_submit_time: '25:99' }, null)).rejects.toBeInstanceOf(
      InvalidDailyReportConfigError
    );
  });

  it('leaves the switch alone when the patch does not mention it', async () => {
    const { state, row } = rowStub({ sales_auto_submit_time: '10:30' });
    m.findOne.mockResolvedValue(row);
    await updateDailyReportConfig({ warning_threshold: 4 }, null);
    expect(state.sales_auto_submit_time).toBe('10:30');
  });
});

// The other half of the request: auto-submit goes away, the auto DATA stays.
// Nothing covered mergeAutoMatrix before, which is the function that actually
// delivers that promise on both paths that use it — the read in
// dailyReportService (so the rep opens a pre-filled report) and the overlay in
// dailyReportStore.saveReport (so the figures are refreshed on submit).
describe('the auto-fetched figures still fill themselves in', () => {
  const AUTO = {
    'New Leads Generated': { AI: 2, AV: 1, Robotics: 0 },
    'Quotations Prepared': { AI: 0, AV: 3, Robotics: 0 }
  };

  it('fills the auto measures into an untouched report', () => {
    expect(mergeAutoMatrix({}, AUTO)).toEqual(AUTO);
  });

  it('works from a report that does not exist yet', () => {
    expect(mergeAutoMatrix(null, AUTO)).toEqual(AUTO);
    expect(mergeAutoMatrix(undefined, AUTO)).toEqual(AUTO);
  });

  it('re-derives auto cells, overwriting whatever was stored', () => {
    // Auto cells are recomputed every time, so a stale stored figure loses.
    const stored = { 'New Leads Generated': { AI: 99, AV: 99, Robotics: 99 } };
    expect(mergeAutoMatrix(stored, AUTO)['New Leads Generated']).toEqual({ AI: 2, AV: 1, Robotics: 0 });
  });

  // The guarantee that matters most: the two hand-typed Sales measures.
  it('leaves hand-typed measures completely untouched', () => {
    const stored = {
      'Meetings Completed': { AI: 4, AV: 2, Robotics: 0 },
      'Meetings Scheduled': { AI: 1, AV: 0, Robotics: 3 }
    };
    const merged = mergeAutoMatrix(stored, AUTO);
    expect(merged['Meetings Completed']).toEqual({ AI: 4, AV: 2, Robotics: 0 });
    expect(merged['Meetings Scheduled']).toEqual({ AI: 1, AV: 0, Robotics: 3 });
    // and the auto ones arrived alongside them
    expect(merged['Quotations Prepared']).toEqual({ AI: 0, AV: 3, Robotics: 0 });
  });

  it('keeps a channel the auto fetch did not report on', () => {
    const stored = { 'New Leads Generated': { Legacy: 7 } };
    expect(mergeAutoMatrix(stored, AUTO)['New Leads Generated']).toEqual({ Legacy: 7, AI: 2, AV: 1, Robotics: 0 });
  });

  it('does not mutate the stored matrix it was handed', () => {
    const stored = { 'Meetings Completed': { AI: 4 }, 'New Leads Generated': { AI: 99 } };
    const snapshot = JSON.parse(JSON.stringify(stored));
    mergeAutoMatrix(stored, AUTO);
    expect(stored).toEqual(snapshot);
  });
});

describe('the cron wake-up schedule', () => {
  const TIMES = { final_reminder_time: '10:00', deadline_time: '11:30', evening_reminder_time: '21:00' };

  it('has no auto-submit wake-up when the switch is blank', () => {
    expect(sweepClockTimes({ ...TIMES, sales_auto_submit_time: '' })).toEqual(['10:00', '11:30', '21:00']);
  });

  it('has none when the switch is absent entirely', () => {
    expect(sweepClockTimes(TIMES)).toEqual(['10:00', '11:30', '21:00']);
  });

  it('adds the wake-up back when a time is set', () => {
    expect(sweepClockTimes({ ...TIMES, sales_auto_submit_time: '10:30' })).toEqual(['10:00', '10:30', '11:30', '21:00']);
  });
});
