import { describe, it, expect } from 'vitest';
import {
  DATA_START_MONTH,
  DATA_START_YEAR,
  firstMonthOf,
  lastMonthOf,
  monthIsSelectable,
  quarterIsSelectable,
  resolveRange
} from '../../lib/hrReportPeriod';

// "Now" as a fixed point, so these never start failing in a later month.
const OCT_2026 = { year: 2026, month: 10 };

describe('the data floor', () => {
  // The regression this file exists for. The floor used to say July 2026,
  // while Office Operation held entries from 2026-04-30 — so April, May and
  // June were not offered by the pickers and a whole-year range began in
  // July. Three months of real spend were unreachable, and because the
  // report happily returns zero rows for a range, nothing said so.
  const EARLIEST_REAL_ENTRY = '2026-04-30';

  it('is not later than the earliest entry in either register', () => {
    const floor = `${DATA_START_YEAR}-${String(DATA_START_MONTH).padStart(2, '0')}-01`;
    expect(floor <= EARLIEST_REAL_ENTRY).toBe(true);
  });

  it('puts the earliest entry inside the whole-year range', () => {
    const { from, to } = resolveRange(2026, 'year', 'all', OCT_2026);
    expect(from <= EARLIEST_REAL_ENTRY && EARLIEST_REAL_ENTRY <= to).toBe(true);
  });

  it('puts the earliest entry inside its own month range', () => {
    const { from, to } = resolveRange(2026, 'month', 4, OCT_2026);
    expect(from).toBe('2026-04-01');
    expect(to).toBe('2026-04-30');
    expect(from <= EARLIEST_REAL_ENTRY && EARLIEST_REAL_ENTRY <= to).toBe(true);
  });

  it('offers every month from the floor to the month in progress', () => {
    const offered = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => monthIsSelectable(m, 2026, OCT_2026));
    expect(offered).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it('offers no month before the floor', () => {
    expect(monthIsSelectable(3, 2026, OCT_2026)).toBe(false);
    expect(monthIsSelectable(1, 2026, OCT_2026)).toBe(false);
  });
});

describe('quarters', () => {
  // Q2 was the worst of it: the old floor sat in Q3, so Q2 failed the
  // overlap test outright and the quarter holding every April-June entry
  // could not be selected at all.
  it('offers the quarter the floor falls partway through', () => {
    expect(quarterIsSelectable(2, 2026, OCT_2026)).toBe(true);
  });

  it('does not offer a quarter that ends before the floor', () => {
    expect(quarterIsSelectable(1, 2026, OCT_2026)).toBe(false);
  });

  it('offers the quarter in progress but not the one after it', () => {
    expect(quarterIsSelectable(4, 2026, OCT_2026)).toBe(true);
    expect(quarterIsSelectable(4, 2026, { year: 2026, month: 9 })).toBe(false);
  });

  it('clamps the quarter in progress to the current month', () => {
    expect(resolveRange(2026, 'quarter', 4, OCT_2026)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('runs a finished quarter end to end', () => {
    expect(resolveRange(2026, 'quarter', 2, OCT_2026)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });
});

describe('years after the first', () => {
  it('starts in January, because the floor only applies to the first year', () => {
    expect(firstMonthOf(2027)).toBe(1);
    expect(firstMonthOf(DATA_START_YEAR)).toBe(DATA_START_MONTH);
    expect(monthIsSelectable(1, 2027, { year: 2028, month: 3 })).toBe(true);
  });

  it('runs a finished year end to end', () => {
    expect(resolveRange(2027, 'year', 'all', { year: 2028, month: 3 })).toEqual({ from: '2027-01-01', to: '2027-12-31' });
  });

  it('ends a finished year in December and the current one at this month', () => {
    expect(lastMonthOf(2026, { year: 2027, month: 5 })).toBe(12);
    expect(lastMonthOf(2026, OCT_2026)).toBe(10);
  });

  it('gets February right in a leap year', () => {
    expect(resolveRange(2028, 'month', 2, { year: 2029, month: 1 })).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('the month in progress', () => {
  it('ends the range at the current month rather than December', () => {
    expect(resolveRange(2026, 'year', 'all', OCT_2026).to).toBe('2026-10-31');
  });

  it('offers no month that has not started', () => {
    expect(monthIsSelectable(11, 2026, OCT_2026)).toBe(false);
  });
});
