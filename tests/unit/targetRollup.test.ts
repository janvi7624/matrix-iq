import { describe, it, expect } from 'vitest';
import {
  buildTargetsFromMonths,
  fiscalYearMonthKeys,
  normalizeMonthAmounts,
  rollupSummary,
  sumMonths,
  MonthAmounts
} from '../../lib/targetRollup';

const FY = '2026-27';
const LAKH = 100000;

// April-first fiscal order — the order every rollup helper works in.
const KEYS = fiscalYearMonthKeys(FY);

function evenly(amount: number): MonthAmounts {
  return Object.fromEntries(KEYS.map((k) => [k, amount]));
}

// The case the old even-spread cascade could not express: every month a
// different figure.
const VARIED: MonthAmounts = {
  '2026-04': 1 * LAKH,
  '2026-05': 2 * LAKH,
  '2026-06': 3 * LAKH,
  '2026-07': 4 * LAKH,
  '2026-08': 5 * LAKH,
  '2026-09': 6 * LAKH,
  '2026-10': 7 * LAKH,
  '2026-11': 8 * LAKH,
  '2026-12': 9 * LAKH,
  '2027-01': 10 * LAKH,
  '2027-02': 11 * LAKH,
  '2027-03': 12 * LAKH
};

describe('fiscalYearMonthKeys', () => {
  it('lists the 12 months of the Indian financial year, April first', () => {
    expect(KEYS).toHaveLength(12);
    expect(KEYS[0]).toBe('2026-04');
    expect(KEYS[8]).toBe('2026-12');
    // Jan-Mar belong to the NEXT calendar year but the SAME fiscal year.
    expect(KEYS[9]).toBe('2027-01');
    expect(KEYS[11]).toBe('2027-03');
  });
});

describe('normalizeMonthAmounts', () => {
  it('zero-fills every month of the year, so a partial entry is still complete', () => {
    const normalized = normalizeMonthAmounts(FY, { '2026-07': LAKH });
    expect(Object.keys(normalized)).toHaveLength(12);
    expect(normalized['2026-07']).toBe(LAKH);
    expect(normalized['2026-04']).toBe(0);
  });

  it('treats blanks, negatives and junk as no target that month', () => {
    const normalized = normalizeMonthAmounts(FY, {
      '2026-04': Number.NaN,
      '2026-05': -5000,
      '2026-06': 0
    } as MonthAmounts);
    expect(normalized['2026-04']).toBe(0);
    expect(normalized['2026-05']).toBe(0);
    expect(normalized['2026-06']).toBe(0);
  });

  it('ignores keys outside the fiscal year', () => {
    const normalized = normalizeMonthAmounts(FY, { '2025-04': LAKH } as MonthAmounts);
    expect(normalized['2025-04']).toBeUndefined();
    expect(Object.values(normalized).every((v) => v === 0)).toBe(true);
  });
});

describe('sumMonths', () => {
  it('adds only the months inside the range', () => {
    // Q1 = Apr+May+Jun of VARIED = 1+2+3 lakh.
    expect(sumMonths(FY, VARIED, '2026-04-01', '2026-06-30')).toBe(6 * LAKH);
  });

  it('spans the calendar-year boundary for Q4 (Jan-Mar)', () => {
    expect(sumMonths(FY, VARIED, '2027-01-01', '2027-03-31')).toBe(33 * LAKH); // 10+11+12
  });
});

describe('rollupSummary', () => {
  it('totals each quarter, half and the year from the months — not an even spread', () => {
    const rollup = rollupSummary(FY, VARIED);

    expect(rollup.quarters.map((q) => [q.key, q.amount])).toEqual([
      ['Q1', 6 * LAKH],   // 1+2+3
      ['Q2', 15 * LAKH],  // 4+5+6
      ['Q3', 24 * LAKH],  // 7+8+9
      ['Q4', 33 * LAKH]   // 10+11+12
    ]);
    expect(rollup.halves.map((h) => [h.key, h.amount])).toEqual([
      ['H1', 21 * LAKH],  // Apr-Sep
      ['H2', 57 * LAKH]   // Oct-Mar
    ]);
    // 1+2+…+12 = 78
    expect(rollup.annual).toBe(78 * LAKH);
  });

  it('reports each month back exactly as entered', () => {
    const rollup = rollupSummary(FY, VARIED);
    expect(rollup.months).toHaveLength(12);
    expect(rollup.months[0]).toMatchObject({ key: '2026-04', amount: 1 * LAKH });
    expect(rollup.months[11]).toMatchObject({ key: '2027-03', amount: 12 * LAKH });
  });

  it('matches the old even-spread figures when every month IS the same', () => {
    // The previous behaviour is now just one special case of the general one:
    // 1L a month still means 3L a quarter, 6L a half, 12L a year.
    const rollup = rollupSummary(FY, evenly(LAKH));
    expect(rollup.quarters.every((q) => q.amount === 3 * LAKH)).toBe(true);
    expect(rollup.halves.every((h) => h.amount === 6 * LAKH)).toBe(true);
    expect(rollup.annual).toBe(12 * LAKH);
  });

  it('counts a skipped month as zero rather than averaging around it', () => {
    // A rep who starts in July: no April/May/June target, so Q1 is zero and
    // the year is the sum of the nine months actually set.
    const fromJuly = Object.fromEntries(KEYS.slice(3).map((k) => [k, LAKH]));
    const rollup = rollupSummary(FY, fromJuly);
    expect(rollup.quarters[0].amount).toBe(0);
    expect(rollup.quarters[1].amount).toBe(3 * LAKH);
    expect(rollup.annual).toBe(9 * LAKH);
  });

  it('keeps paise exact instead of drifting', () => {
    const rollup = rollupSummary(FY, { '2026-04': 83333.33, '2026-05': 83333.33, '2026-06': 83333.34 });
    expect(rollup.quarters[0].amount).toBe(250000);
    expect(rollup.annual).toBe(250000);
  });
});

describe('buildTargetsFromMonths', () => {
  const rows = buildTargetsFromMonths(FY, VARIED);

  it('covers every period of the fiscal year exactly once', () => {
    expect(rows).toHaveLength(19); // 12 months + 4 quarters + 2 halves + 1 year
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.periodType] = (acc[r.periodType] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ monthly: 12, quarterly: 4, half_yearly: 2, annual: 1 });

    const keys = rows.map((r) => `${r.periodType}|${r.periodStart}`);
    expect(new Set(keys).size).toBe(rows.length);
  });

  it('gives each month its own entered figure — the point of the change', () => {
    const monthly = rows.filter((r) => r.periodType === 'monthly');
    const amounts = new Set(monthly.map((r) => r.targetAmount));
    expect(amounts.size).toBe(12); // all different, which the old cascade forbade
    expect(monthly.find((r) => r.periodStart === '2026-04-01')?.targetAmount).toBe(1 * LAKH);
    expect(monthly.find((r) => r.periodStart === '2027-03-01')?.targetAmount).toBe(12 * LAKH);
  });

  it('derives every quarter/half/year row as the sum of its own months', () => {
    expect(rows.find((r) => r.periodType === 'quarterly' && r.periodKey === 'Q2')?.targetAmount).toBe(15 * LAKH);
    expect(rows.find((r) => r.periodType === 'half_yearly' && r.periodKey === 'H2')?.targetAmount).toBe(57 * LAKH);
    expect(rows.find((r) => r.periodType === 'annual')?.targetAmount).toBe(78 * LAKH);
  });

  it('agrees with rollupSummary, which the form previews from', () => {
    const rollup = rollupSummary(FY, VARIED);
    for (const q of rollup.quarters) {
      expect(rows.find((r) => r.periodType === 'quarterly' && r.periodKey === q.key)?.targetAmount).toBe(q.amount);
    }
    expect(rows.find((r) => r.periodType === 'annual')?.targetAmount).toBe(rollup.annual);
  });

  it('carries each period its own stored range, label and fiscal year', () => {
    expect(rows.find((r) => r.periodType === 'quarterly' && r.periodKey === 'Q4')).toMatchObject({
      periodStart: '2027-01-01',
      periodEnd: '2027-03-31',
      displayPeriod: 'Q4 FY2026-27',
      fiscalYear: FY,
      targetAmount: 33 * LAKH
    });
    expect(rows.find((r) => r.periodType === 'annual')).toMatchObject({
      periodStart: '2026-04-01',
      periodEnd: '2027-03-31'
    });
  });

  it('writes zeroes for untouched months rather than leaving them stale', () => {
    // Saving only July must not leave June carrying last year's figure — the
    // write covers all 19 periods every time.
    const onlyJuly = buildTargetsFromMonths(FY, { '2026-07': LAKH });
    expect(onlyJuly).toHaveLength(19);
    expect(onlyJuly.find((r) => r.periodStart === '2026-06-01')?.targetAmount).toBe(0);
    expect(onlyJuly.find((r) => r.periodType === 'annual')?.targetAmount).toBe(LAKH);
  });
});
