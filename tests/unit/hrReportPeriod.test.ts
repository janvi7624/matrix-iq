import { describe, it, expect } from 'vitest';
import {
  FALLBACK_BOUNDS,
  PeriodBounds,
  firstMonthOf,
  lastMonthOf,
  monthIsSelectable,
  quarterIsSelectable,
  resolveRange,
  selectableYears
} from '../../lib/hrReportPeriod';

// Which periods the HR Expense Report offers.
//
// This module's failure mode is SILENT — a period it declines to offer is a
// period whose spend nobody can see, and the report happily returns zero
// rows for an empty range, so nothing says so. It has failed in production
// twice:
//
//   1. The floor said July 2026 while Office Operation held entries from
//      2026-04-30, hiding April, May and June.
//   2. The floor was corrected to April, then a 2026-01-14 entry was added
//      and January went missing. At the same time the CEILING, capped at the
//      month in progress, was hiding ~6.6 lakh of future-dated November and
//      December reimbursements.
//
// Both ends are now derived from min(date)/max(date) across the two
// registers instead of hand-maintained constants. Some assertions below are
// therefore the INVERSE of what this file used to assert — each of those is
// marked, because the old behaviour was the bug.

/** "Now" as a fixed point, so these never start failing in a later month. */
const OCT_2026 = { year: 2026, month: 10 };

/** The real data window that exposed both bugs. */
const REAL: PeriodBounds = { min: { year: 2026, month: 1 }, max: { year: 2026, month: 12 } };
/** A window that stops before "now" — nothing future-dated. */
const TO_OCTOBER: PeriodBounds = { min: { year: 2026, month: 1 }, max: { year: 2026, month: 10 } };
/** The old April floor, for the cases where a genuinely later floor applies. */
const FROM_APRIL: PeriodBounds = { min: { year: 2026, month: 4 }, max: { year: 2026, month: 10 } };

describe('the floor', () => {
  const EARLIEST_REAL_ENTRY = '2026-01-14';

  it('offers January when January has spend', () => {
    // INVERTED: this file used to assert month 1 was NOT selectable. That
    // assertion was the bug — it encoded the hardcoded April floor.
    expect(monthIsSelectable(1, 2026, OCT_2026, REAL)).toBe(true);
    expect(firstMonthOf(2026, REAL)).toBe(1);
  });

  it('puts the earliest entry inside the whole-year range', () => {
    const { from, to } = resolveRange(2026, 'year', 'all', OCT_2026, REAL);
    expect(from <= EARLIEST_REAL_ENTRY && EARLIEST_REAL_ENTRY <= to).toBe(true);
  });

  it('puts the earliest entry inside its own month range', () => {
    const { from, to } = resolveRange(2026, 'month', 1, OCT_2026, REAL);
    expect(from).toBe('2026-01-01');
    expect(to).toBe('2026-01-31');
    expect(from <= EARLIEST_REAL_ENTRY && EARLIEST_REAL_ENTRY <= to).toBe(true);
  });

  it('still respects a genuinely later floor', () => {
    // When the earliest spend really is April, offering January would open
    // the report with guaranteed-empty columns.
    expect(monthIsSelectable(3, 2026, OCT_2026, FROM_APRIL)).toBe(false);
    expect(monthIsSelectable(4, 2026, OCT_2026, FROM_APRIL)).toBe(true);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => monthIsSelectable(m, 2026, OCT_2026, FROM_APRIL))).toEqual([
      4, 5, 6, 7, 8, 9, 10
    ]);
  });

  it('starts a later year at January, because the floor only applies to the first', () => {
    expect(firstMonthOf(2027, REAL)).toBe(1);
    expect(monthIsSelectable(1, 2027, { year: 2028, month: 3 }, REAL)).toBe(true);
  });
});

describe('the ceiling', () => {
  it('offers months beyond the one in progress when they hold spend', () => {
    // INVERTED: this file used to assert month 11 was NOT selectable in
    // October. Reporting on an empty future month is harmless; hiding one
    // with spend in it is not.
    expect(monthIsSelectable(11, 2026, OCT_2026, REAL)).toBe(true);
    expect(monthIsSelectable(12, 2026, OCT_2026, REAL)).toBe(true);
    expect(lastMonthOf(2026, OCT_2026, REAL)).toBe(12);
  });

  it('offers no month that has not started when nothing is dated there', () => {
    // The original rule, still correct in the ordinary case.
    expect(monthIsSelectable(11, 2026, OCT_2026, TO_OCTOBER)).toBe(false);
    expect(lastMonthOf(2026, OCT_2026, TO_OCTOBER)).toBe(10);
    expect(resolveRange(2026, 'year', 'all', OCT_2026, TO_OCTOBER).to).toBe('2026-10-31');
  });

  it('ends a finished year in December and the current one at this month', () => {
    expect(lastMonthOf(2026, { year: 2027, month: 5 }, TO_OCTOBER)).toBe(12);
    expect(lastMonthOf(2026, OCT_2026, TO_OCTOBER)).toBe(10);
  });
});

describe('year choices', () => {
  it('runs from the first year with spend to the current year', () => {
    const spanning: PeriodBounds = { min: { year: 2024, month: 5 }, max: { year: 2026, month: 10 } };
    expect(selectableYears(OCT_2026, spanning)).toEqual([2026, 2025, 2024]);
  });

  it('includes a future year that already holds spend', () => {
    const future: PeriodBounds = { min: { year: 2026, month: 1 }, max: { year: 2027, month: 2 } };
    expect(selectableYears(OCT_2026, future)).toEqual([2027, 2026]);
  });

  it('always offers at least the current year', () => {
    expect(selectableYears(OCT_2026, FALLBACK_BOUNDS)).toContain(2026);
  });
});

describe('quarters', () => {
  it('offers Q1 once January is in range', () => {
    // INVERTED: used to assert Q1 was not selectable, under the April floor.
    expect(quarterIsSelectable(1, 2026, OCT_2026, REAL)).toBe(true);
  });

  it('offers the quarter the floor falls partway through', () => {
    // Q2 was the worst of the original bug: the old floor sat in Q3, so the
    // quarter holding every April-June entry could not be selected at all.
    expect(quarterIsSelectable(2, 2026, OCT_2026, FROM_APRIL)).toBe(true);
  });

  it('does not offer a quarter that ends before the floor', () => {
    expect(quarterIsSelectable(1, 2026, OCT_2026, FROM_APRIL)).toBe(false);
  });

  it('offers the quarter in progress but not the one after it', () => {
    const toSeptember: PeriodBounds = { min: { year: 2026, month: 1 }, max: { year: 2026, month: 9 } };
    expect(quarterIsSelectable(3, 2026, { year: 2026, month: 9 }, toSeptember)).toBe(true);
    expect(quarterIsSelectable(4, 2026, { year: 2026, month: 9 }, toSeptember)).toBe(false);
  });

  it('clamps the quarter in progress to the current month', () => {
    expect(resolveRange(2026, 'quarter', 4, OCT_2026, TO_OCTOBER)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('runs a finished quarter end to end', () => {
    expect(resolveRange(2026, 'quarter', 2, OCT_2026, REAL)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('offers Q4 when December holds spend', () => {
    expect(quarterIsSelectable(4, 2026, OCT_2026, REAL)).toBe(true);
  });
});

describe('resolveRange', () => {
  it('spans the whole data window for a yearly report', () => {
    // Previously began in April and stopped in October, silently excluding
    // both ends.
    expect(resolveRange(2026, 'year', 'all', OCT_2026, REAL)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('runs a finished year end to end', () => {
    const next: PeriodBounds = { min: { year: 2026, month: 1 }, max: { year: 2028, month: 3 } };
    expect(resolveRange(2027, 'year', 'all', { year: 2028, month: 3 }, next)).toEqual({ from: '2027-01-01', to: '2027-12-31' });
  });

  it('gets the last day of each month right, including a leap February', () => {
    expect(resolveRange(2026, 'month', 2, OCT_2026, REAL)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    const leap: PeriodBounds = { min: { year: 2026, month: 1 }, max: { year: 2029, month: 1 } };
    expect(resolveRange(2028, 'month', 2, { year: 2029, month: 1 }, leap)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('covers the January entry that was reported missing', () => {
    const { from, to } = resolveRange(2026, 'month', 1, OCT_2026, REAL);
    expect(from <= '2026-01-14' && '2026-01-14' <= to).toBe(true);
  });
});
