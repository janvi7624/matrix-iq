import { describe, it, expect } from 'vitest';
import { checkSubmittablePeriod, submittableFrom, monthName, lastClaimableMonth, checkAddPeriod } from '@/lib/reimbursementPeriod';

// The rule: a reimbursement sheet may only be submitted for a month that has
// finished. No lower bound — an old forgotten month is still claimable.
// `now` is passed explicitly everywhere so these never depend on the clock.

const sep24 = new Date(2026, 8, 24); // 24 September 2026 (month is 0-based)

describe('checkSubmittablePeriod', () => {
  it('refuses the month that is still running', () => {
    const result = checkSubmittablePeriod(2026, 9, sep24);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('September 2026');
    expect(result.reason).toContain('1 October 2026');
  });

  it('refuses the current month on its very first day', () => {
    expect(checkSubmittablePeriod(2026, 9, new Date(2026, 8, 1)).allowed).toBe(false);
  });

  it('refuses the current month on its very last day', () => {
    expect(checkSubmittablePeriod(2026, 9, new Date(2026, 8, 30)).allowed).toBe(false);
  });

  it('allows the month that just ended, from its first minute', () => {
    expect(checkSubmittablePeriod(2026, 8, new Date(2026, 8, 1, 0, 0, 0)).allowed).toBe(true);
  });

  it('allows the three months the user named — June, July, August — in September', () => {
    for (const m of [6, 7, 8]) {
      const result = checkSubmittablePeriod(2026, m, sep24);
      expect(result.allowed, `${monthName(m)} should be submittable`).toBe(true);
      expect(result.reason).toBe('');
    }
  });

  it('has no lower bound — a forgotten month from earlier in the year is still claimable', () => {
    expect(checkSubmittablePeriod(2026, 1, sep24).allowed).toBe(true);
    expect(checkSubmittablePeriod(2025, 11, sep24).allowed).toBe(true);
    expect(checkSubmittablePeriod(2019, 3, sep24).allowed).toBe(true);
  });

  it('refuses a month that has not happened yet', () => {
    const result = checkSubmittablePeriod(2026, 10, sep24);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('hasn’t started yet');
    expect(checkSubmittablePeriod(2027, 1, sep24).allowed).toBe(false);
  });

  it('crosses the year boundary without a special case', () => {
    const jan5 = new Date(2027, 0, 5);
    expect(checkSubmittablePeriod(2026, 12, jan5).allowed).toBe(true); // last month
    expect(checkSubmittablePeriod(2027, 1, jan5).allowed).toBe(false); // this month
    const dec31 = new Date(2026, 11, 31);
    expect(checkSubmittablePeriod(2026, 12, dec31).allowed).toBe(false);
    expect(checkSubmittablePeriod(2026, 11, dec31).allowed).toBe(true);
  });

  it('rejects a nonsense month rather than guessing', () => {
    expect(checkSubmittablePeriod(2026, 0, sep24).allowed).toBe(false);
    expect(checkSubmittablePeriod(2026, 13, sep24).allowed).toBe(false);
    expect(checkSubmittablePeriod(2026, 1.5, sep24).allowed).toBe(false);
    expect(checkSubmittablePeriod(NaN, 5, sep24).allowed).toBe(false);
  });
});

describe('lastClaimableMonth', () => {
  it('is the calendar month right before now', () => {
    expect(lastClaimableMonth(sep24)).toEqual({ year: 2026, month: 8 });
  });

  it('crosses the year boundary in January', () => {
    expect(lastClaimableMonth(new Date(2027, 0, 5))).toEqual({ year: 2026, month: 12 });
  });
});

// HR-mandated (2026-09): a new bill may only be dated in the month right
// before now — not the still-running current month, not an older forgotten
// one — unless it belongs to a sheet already sent back for correction.
describe('checkAddPeriod', () => {
  it('allows a date in the immediately preceding month', () => {
    expect(checkAddPeriod('2026-08-15', sep24).allowed).toBe(true);
  });

  it('refuses a date in the still-running current month', () => {
    const result = checkAddPeriod('2026-09-10', sep24);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('August 2026');
  });

  it('refuses an older, forgotten month — unlike checkSubmittablePeriod, there is a lower bound here', () => {
    expect(checkAddPeriod('2026-06-01', sep24).allowed).toBe(false);
    expect(checkAddPeriod('2025-01-01', sep24).allowed).toBe(false);
  });

  it('refuses a future month', () => {
    expect(checkAddPeriod('2026-10-01', sep24).allowed).toBe(false);
  });

  it('crosses the year boundary without a special case', () => {
    const jan5 = new Date(2027, 0, 5);
    expect(checkAddPeriod('2026-12-15', jan5).allowed).toBe(true);
    expect(checkAddPeriod('2027-01-02', jan5).allowed).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(checkAddPeriod('', sep24).allowed).toBe(false);
    expect(checkAddPeriod('not-a-date', sep24).allowed).toBe(false);
  });

  it('exempts a sheet already sent back for correction, regardless of how old its month is', () => {
    expect(checkAddPeriod('2026-06-01', sep24, 'manager_change_requested').allowed).toBe(true);
    expect(checkAddPeriod('2025-01-01', sep24, 'hr_change_requested').allowed).toBe(true);
  });

  it('does not exempt a plain draft sheet outside the claimable month', () => {
    expect(checkAddPeriod('2026-06-01', sep24, 'draft').allowed).toBe(false);
  });
});

describe('submittableFrom', () => {
  it('is the first day of the following month', () => {
    const d = submittableFrom(2026, 9);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9); // October
    expect(d.getDate()).toBe(1);
  });

  it('rolls December into next January', () => {
    const d = submittableFrom(2026, 12);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });
});
