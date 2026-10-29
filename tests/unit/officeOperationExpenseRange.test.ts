import { describe, it, expect } from 'vitest';
import { monthRangeBounds, resolveMonthRange } from '../../lib/officeOperationExpenseValidation';

// The HR → Office Operation Expenses custom month range ("from this month to
// that month"). Two pure pieces, both easy to get subtly wrong:
//
//   monthRangeBounds  the half-open date window a range covers. Month-end and
//                     December rollover live here.
//   resolveMonthRange the filter's query values -> an ordered range, with the
//                     fallbacks that keep the old single-month callers working.

const NOW = { year: 2026, month: 10 };

describe('monthRangeBounds', () => {
  it('covers a single month up to the 1st of the next', () => {
    expect(monthRangeBounds({ year: 2026, month: 10 }, { year: 2026, month: 10 })).toEqual({
      startDate: '2026-10-01',
      endDateExclusive: '2026-11-01'
    });
  });

  it('spans a multi-month range within one year', () => {
    expect(monthRangeBounds({ year: 2026, month: 8 }, { year: 2026, month: 10 })).toEqual({
      startDate: '2026-08-01',
      endDateExclusive: '2026-11-01'
    });
  });

  // The rollover that a naive `month + 1` gets wrong.
  it('rolls December into January of the next year', () => {
    expect(monthRangeBounds({ year: 2026, month: 12 }, { year: 2026, month: 12 })).toEqual({
      startDate: '2026-12-01',
      endDateExclusive: '2027-01-01'
    });
  });

  it('spans a range that crosses the new year', () => {
    expect(monthRangeBounds({ year: 2026, month: 11 }, { year: 2027, month: 2 })).toEqual({
      startDate: '2026-11-01',
      endDateExclusive: '2027-03-01'
    });
  });

  // Half-open bounds are why February needs no special case at all.
  it('needs no special case for February, leap year or not', () => {
    expect(monthRangeBounds({ year: 2028, month: 2 }, { year: 2028, month: 2 }).endDateExclusive).toBe('2028-03-01');
    expect(monthRangeBounds({ year: 2026, month: 2 }, { year: 2026, month: 2 }).endDateExclusive).toBe('2026-03-01');
  });

  it('zero-pads single-digit months so the strings sort and compare correctly', () => {
    expect(monthRangeBounds({ year: 2026, month: 1 }, { year: 2026, month: 9 })).toEqual({
      startDate: '2026-01-01',
      endDateExclusive: '2026-10-01'
    });
  });
});

describe('resolveMonthRange', () => {
  it('falls back to the current month when nothing is supplied', () => {
    expect(resolveMonthRange({}, NOW)).toEqual({ from: NOW, to: NOW });
  });

  // Back-compat: the shape this endpoint took before the range existed.
  it('treats a bare year/month as that single month', () => {
    expect(resolveMonthRange({ year: '2026', month: '8' }, NOW)).toEqual({
      from: { year: 2026, month: 8 },
      to: { year: 2026, month: 8 }
    });
  });

  it('reads a full range', () => {
    expect(resolveMonthRange({ fromYear: '2026', fromMonth: '6', toYear: '2026', toMonth: '9' }, NOW)).toEqual({
      from: { year: 2026, month: 6 },
      to: { year: 2026, month: 9 }
    });
  });

  it('reads a range that crosses the new year', () => {
    expect(resolveMonthRange({ fromYear: '2025', fromMonth: '11', toYear: '2026', toMonth: '3' }, NOW)).toEqual({
      from: { year: 2025, month: 11 },
      to: { year: 2026, month: 3 }
    });
  });

  // Picked backwards: swap rather than return an empty register, which would
  // read as "no expenses" instead of "you picked the ends the wrong way".
  it('swaps a backwards range', () => {
    expect(resolveMonthRange({ fromYear: '2026', fromMonth: '10', toYear: '2026', toMonth: '6' }, NOW)).toEqual({
      from: { year: 2026, month: 6 },
      to: { year: 2026, month: 10 }
    });
  });

  it('swaps a backwards range across years', () => {
    expect(resolveMonthRange({ fromYear: '2027', fromMonth: '1', toYear: '2026', toMonth: '12' }, NOW)).toEqual({
      from: { year: 2026, month: 12 },
      to: { year: 2027, month: 1 }
    });
  });

  it('leaves an equal-ended range alone', () => {
    const r = resolveMonthRange({ fromYear: '2026', fromMonth: '7', toYear: '2026', toMonth: '7' }, NOW);
    expect(r).toEqual({ from: { year: 2026, month: 7 }, to: { year: 2026, month: 7 } });
  });

  it('fills a half-specified range from the single-month pair', () => {
    // Only the far end given: the near end falls back to year/month.
    expect(resolveMonthRange({ year: '2026', month: '4', toMonth: '7' }, NOW)).toEqual({
      from: { year: 2026, month: 4 },
      to: { year: 2026, month: 7 }
    });
  });

  // A stray value in somebody's bookmark must show a month, not 400.
  it.each([
    ['month zero', { month: '0' }],
    ['month thirteen', { month: '13' }],
    ['a negative month', { month: '-3' }],
    ['a non-numeric month', { month: 'October' }],
    ['a fractional month', { month: '6.5' }],
    ['an empty string', { month: '' }],
    ['null', { month: null }]
  ])('falls back on %s', (_label, raw) => {
    expect(resolveMonthRange(raw, NOW)).toEqual({ from: NOW, to: NOW });
  });

  it('falls back on an implausible year', () => {
    expect(resolveMonthRange({ year: '1200' }, NOW).from.year).toBe(NOW.year);
    expect(resolveMonthRange({ year: '9999' }, NOW).from.year).toBe(NOW.year);
  });

  it('accepts the edge months', () => {
    expect(resolveMonthRange({ fromMonth: '1', toMonth: '12' }, NOW)).toEqual({
      from: { year: 2026, month: 1 },
      to: { year: 2026, month: 12 }
    });
  });

  // The two together: whatever the filter sends, the window is sane.
  it('composes with monthRangeBounds even from a backwards range', () => {
    const { from, to } = resolveMonthRange({ fromYear: '2026', fromMonth: '12', toYear: '2026', toMonth: '11' }, NOW);
    expect(monthRangeBounds(from, to)).toEqual({ startDate: '2026-11-01', endDateExclusive: '2027-01-01' });
  });
});
