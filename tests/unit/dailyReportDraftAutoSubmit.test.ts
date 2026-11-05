import { describe, it, expect, vi, beforeEach } from 'vitest';

// Submitting a saved DRAFT on its owner's behalf, shortly before the
// deadline, so someone who filled in their report but forgot to press
// submit is not warned for a report they actually wrote.
//
// The switch is `draft_auto_submit_time` — blank means off, and blank is the
// default, same convention as `sales_auto_submit_time`. What these pin:
//   1. the default really is off, so a fresh install never auto-files;
//   2. blank survives a config update instead of being coerced back to a
//      time, and a malformed value is rejected rather than guessed;
//   3. the cron wakes up for it once a time is configured, alongside the
//      other event times, and not otherwise.
//
// What this does NOT cover (see lib/dailyReportSweepPlan.test.ts and
// lib/dailyReportScheduler.ts's own comments instead): the actual decision
// of WHO gets auto-submitted is planAutoSubmits, unchanged and already
// generic; the NEW part is restricting its subjects to people who already
// have a DRAFT (lib/dailyReportStore.ts's loadDraftKeys), which is a thin,
// DB-backed query in the same shape as loadSubmittedKeys right above it.

const m = vi.hoisted(() => ({ findOne: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() }));
vi.mock('../../lib/db', () => ({
  db: {
    DailyReportConfig: { findOne: m.findOne, create: m.create, update: m.update, count: m.count },
    User: { findOne: vi.fn(), findByPk: vi.fn() }
  },
  isUuid: () => true,
  sequelize: { query: vi.fn() }
}));

import { DEFAULT_DAILY_REPORT_CONFIG, InvalidDailyReportConfigError, updateDailyReportConfig } from '../../lib/dailyReportConfigStore';
import { sweepClockTimes } from '../../lib/dailyReportAutoSweep';

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
  it('ships with draft auto-submit off', () => {
    expect(DEFAULT_DAILY_REPORT_CONFIG.draft_auto_submit_time).toBe('');
  });
});

describe('updating the switch', () => {
  it('accepts blank, and keeps it blank', async () => {
    const { state, row } = rowStub({ draft_auto_submit_time: '11:29' });
    m.findOne.mockResolvedValue(row);
    await updateDailyReportConfig({ draft_auto_submit_time: '' }, null);
    expect(state.draft_auto_submit_time).toBe('');
  });

  it('treats a whitespace-only value as blank rather than invalid', async () => {
    const { state, row } = rowStub({ draft_auto_submit_time: '11:29' });
    m.findOne.mockResolvedValue(row);
    await updateDailyReportConfig({ draft_auto_submit_time: '   ' }, null);
    expect(state.draft_auto_submit_time).toBe('');
  });

  it('accepts a real time, one minute ahead of a deadline for instance', async () => {
    const { state, row } = rowStub({ draft_auto_submit_time: '' });
    m.findOne.mockResolvedValue(row);
    await updateDailyReportConfig({ draft_auto_submit_time: '11:29' }, null);
    expect(state.draft_auto_submit_time).toBe('11:29');
  });

  it('rejects a malformed time instead of silently switching it on', async () => {
    const { row } = rowStub({ draft_auto_submit_time: '' });
    m.findOne.mockResolvedValue(row);
    await expect(updateDailyReportConfig({ draft_auto_submit_time: '25:99' }, null)).rejects.toBeInstanceOf(
      InvalidDailyReportConfigError
    );
  });

  it('leaves the switch alone when the patch does not mention it', async () => {
    const { state, row } = rowStub({ draft_auto_submit_time: '11:29' });
    m.findOne.mockResolvedValue(row);
    await updateDailyReportConfig({ warning_threshold: 4 }, null);
    expect(state.draft_auto_submit_time).toBe('11:29');
  });
});

describe('the cron wake-up schedule', () => {
  const TIMES = { final_reminder_time: '10:00', deadline_time: '11:30', evening_reminder_time: '21:00' };

  it('has no wake-up when the switch is blank', () => {
    expect(sweepClockTimes({ ...TIMES, draft_auto_submit_time: '' })).toEqual(['10:00', '11:30', '21:00']);
  });

  it('has none when the switch is absent entirely', () => {
    expect(sweepClockTimes(TIMES)).toEqual(['10:00', '11:30', '21:00']);
  });

  it('adds the wake-up, in clock order, when a time is set', () => {
    expect(sweepClockTimes({ ...TIMES, draft_auto_submit_time: '11:29' })).toEqual(['10:00', '11:29', '11:30', '21:00']);
  });

  it('coexists with the Sales switch as two independent wake-ups', () => {
    expect(
      sweepClockTimes({ ...TIMES, sales_auto_submit_time: '10:30', draft_auto_submit_time: '11:29' })
    ).toEqual(['10:00', '10:30', '11:29', '11:30', '21:00']);
  });

  it('collapses onto the deadline wake-up if an admin sets it to the same minute', () => {
    expect(sweepClockTimes({ ...TIMES, draft_auto_submit_time: '11:30' })).toEqual(['10:00', '11:30', '21:00']);
  });
});
