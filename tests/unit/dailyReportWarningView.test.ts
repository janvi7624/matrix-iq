import { describe, it, expect } from 'vitest';
import { DailyReportWarningRecord } from '../../lib/dailyReportTypes';
import {
  earlierActiveWarnings,
  finalActiveWarning,
  finalWarningHeadline,
  needsHrAction
} from '../../lib/dailyReportWarningView';

// HR's Warnings tab shows the one warning that asks something of them.
//
// The interesting cases are all waiver cases: "the 4th warning" stops being
// a well-defined thing the moment HR waives one, and the card must still
// point at the right date afterwards.

const w = (date: string, status: 'ACTIVE' | 'WAIVED', id = date): DailyReportWarningRecord =>
  ({
    id,
    employee_id: 'emp-1',
    employee_name: 'Manoj Menon',
    department_name: 'Sales',
    report_date: date,
    month_key: date.slice(0, 7),
    status,
    source: 'scheduler',
    waived_by_name: '',
    waived_at: '',
    waiver_reason: '',
    created_at: `${date}T15:30:00.000Z`
  }) as unknown as DailyReportWarningRecord;

const FOUR = [w('2026-10-24', 'ACTIVE'), w('2026-10-27', 'ACTIVE'), w('2026-10-28', 'ACTIVE'), w('2026-10-30', 'ACTIVE')];

describe('finalActiveWarning', () => {
  it('picks the most recent active warning', () => {
    expect(finalActiveWarning(FOUR)?.report_date).toBe('2026-10-30');
  });

  it('does not depend on the order it is given', () => {
    const shuffled = [FOUR[2], FOUR[0], FOUR[3], FOUR[1]];
    expect(finalActiveWarning(shuffled)?.report_date).toBe('2026-10-30');
  });

  // The reason this is "latest active" and not "the 4th": waiving the last
  // one must move the card to the one before it, not leave it pointing at a
  // warning that no longer counts.
  it('ignores waived warnings', () => {
    const withWaiver = [FOUR[0], FOUR[1], FOUR[2], w('2026-10-30', 'WAIVED')];
    expect(finalActiveWarning(withWaiver)?.report_date).toBe('2026-10-28');
  });

  it('returns null when everything is waived', () => {
    expect(finalActiveWarning(FOUR.map((x) => w(x.report_date, 'WAIVED')))).toBeNull();
  });

  it('returns null for no warnings at all', () => {
    expect(finalActiveWarning([])).toBeNull();
  });

  it('handles a single warning', () => {
    expect(finalActiveWarning([FOUR[0]])?.report_date).toBe('2026-10-24');
  });
});

describe('earlierActiveWarnings', () => {
  it('returns the run-up, oldest first, excluding the final one', () => {
    expect(earlierActiveWarnings(FOUR).map((x) => x.report_date)).toEqual(['2026-10-24', '2026-10-27', '2026-10-28']);
  });

  it('excludes waived dates from the run-up too', () => {
    const mixed = [FOUR[0], w('2026-10-27', 'WAIVED'), FOUR[2], FOUR[3]];
    expect(earlierActiveWarnings(mixed).map((x) => x.report_date)).toEqual(['2026-10-24', '2026-10-28']);
  });

  it('is empty when there is only the final warning', () => {
    expect(earlierActiveWarnings([FOUR[0]])).toEqual([]);
  });

  it('is empty when everything is waived', () => {
    expect(earlierActiveWarnings(FOUR.map((x) => w(x.report_date, 'WAIVED')))).toEqual([]);
  });
});

describe('needsHrAction', () => {
  it('is true at the threshold', () => {
    expect(needsHrAction({ active_warnings: 4, hr_escalated: false }, 4)).toBe(true);
  });

  it('is true over the threshold', () => {
    expect(needsHrAction({ active_warnings: 5, hr_escalated: false }, 4)).toBe(true);
  });

  it('is false below it', () => {
    expect(needsHrAction({ active_warnings: 3, hr_escalated: false }, 4)).toBe(false);
    expect(needsHrAction({ active_warnings: 0, hr_escalated: false }, 4)).toBe(false);
  });

  // Once HR has been told, the case stays on their list even if waivers have
  // since dropped the count — otherwise an escalation could silently vanish.
  it('stays true once escalated, even after waivers drop the count', () => {
    expect(needsHrAction({ active_warnings: 1, hr_escalated: true }, 4)).toBe(true);
  });
});

describe('finalWarningHeadline', () => {
  it('says "Final warning" only when the limit is actually reached', () => {
    expect(finalWarningHeadline({ active_warnings: 4, hr_escalated: false }, 4)).toBe('Final warning · 4 of 4');
  });

  it('says "Latest warning" below the limit, so the strong words stay true', () => {
    expect(finalWarningHeadline({ active_warnings: 2, hr_escalated: false }, 4)).toBe('Latest warning · 2 of 4');
  });

  it('still says "Final warning" for an escalated case under the limit', () => {
    expect(finalWarningHeadline({ active_warnings: 1, hr_escalated: true }, 4)).toBe('Final warning · 1 of 4');
  });
});
