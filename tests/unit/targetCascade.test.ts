import { describe, it, expect } from 'vitest';
import {
  amountForPeriod,
  buildCascadedTargets,
  cascadeSummary,
  monthlyRateFrom,
  MONTHS_IN_PERIOD
} from '../../lib/targetCascade';

const FY = '2026-27';
const LAKH = 100000;

describe('monthlyRateFrom / amountForPeriod', () => {
  it('treats the four period types as one number at four scales', () => {
    expect(monthlyRateFrom('monthly', LAKH)).toBe(LAKH);
    expect(monthlyRateFrom('quarterly', 3 * LAKH)).toBe(LAKH);
    expect(monthlyRateFrom('half_yearly', 6 * LAKH)).toBe(LAKH);
    expect(monthlyRateFrom('annual', 12 * LAKH)).toBe(LAKH);
  });

  it('prices each period off the monthly rate', () => {
    expect(amountForPeriod('monthly', LAKH)).toBe(LAKH);
    expect(amountForPeriod('quarterly', LAKH)).toBe(3 * LAKH);
    expect(amountForPeriod('half_yearly', LAKH)).toBe(6 * LAKH);
    expect(amountForPeriod('annual', LAKH)).toBe(12 * LAKH);
  });
});

describe('cascadeSummary', () => {
  // The two worked examples from the request.
  it('turns a monthly 1,00,000 into a yearly 12,00,000', () => {
    expect(cascadeSummary('monthly', LAKH)).toEqual({
      monthly: 100000,
      quarterly: 300000,
      half_yearly: 600000,
      annual: 1200000
    });
  });

  it('turns a yearly 12,00,000 back into a monthly 1,00,000', () => {
    expect(cascadeSummary('annual', 12 * LAKH)).toEqual({
      monthly: 100000,
      quarterly: 300000,
      half_yearly: 600000,
      annual: 1200000
    });
  });

  it('round-trips from any scale to the same set', () => {
    const fromQuarter = cascadeSummary('quarterly', 3 * LAKH);
    const fromHalf = cascadeSummary('half_yearly', 6 * LAKH);
    expect(fromQuarter).toEqual(fromHalf);
    expect(fromQuarter).toEqual(cascadeSummary('monthly', LAKH));
  });

  it('keeps the entered figure exact when it does not divide evenly', () => {
    // 10,00,000 / 12 = 83,333.333... — the year must stay the number that
    // was actually asked for, not the sum of twelve rounded months.
    const summary = cascadeSummary('annual', 1000000);
    expect(summary.annual).toBe(1000000);
    expect(summary.monthly).toBe(83333.33);
    expect(summary.quarterly).toBe(250000);
    expect(summary.half_yearly).toBe(500000);
  });
});

describe('buildCascadedTargets', () => {
  const rows = buildCascadedTargets(FY, 'monthly', LAKH);

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

  it('prices every period of a type identically — the figure is a rate, not a one-off', () => {
    for (const periodType of ['monthly', 'quarterly', 'half_yearly', 'annual'] as const) {
      const amounts = new Set(rows.filter((r) => r.periodType === periodType).map((r) => r.targetAmount));
      expect(amounts.size).toBe(1);
      expect([...amounts][0]).toBe(LAKH * MONTHS_IN_PERIOD[periodType]);
    }
  });

  it('spans the Indian financial year, April to March', () => {
    const annual = rows.find((r) => r.periodType === 'annual');
    expect(annual?.periodStart).toBe('2026-04-01');
    expect(annual?.periodEnd).toBe('2027-03-31');

    const months = rows.filter((r) => r.periodType === 'monthly').map((r) => r.periodStart);
    expect(months[0]).toBe('2026-04-01');
    expect(months[11]).toBe('2027-03-01');
  });

  it('carries each period its own stored range, display label and fiscal year', () => {
    const q4 = rows.find((r) => r.periodType === 'quarterly' && r.periodKey === 'Q4');
    expect(q4).toMatchObject({
      periodStart: '2027-01-01',
      periodEnd: '2027-03-31',
      displayPeriod: 'Q4 FY2026-27',
      fiscalYear: FY,
      targetAmount: 3 * LAKH
    });
  });

  it('produces the same 19 rows whichever scale was entered', () => {
    const fromAnnual = buildCascadedTargets(FY, 'annual', 12 * LAKH);
    const key = (r: { periodType: string; periodStart: string; targetAmount: number }) =>
      `${r.periodType}|${r.periodStart}|${r.targetAmount}`;
    expect(fromAnnual.map(key).sort()).toEqual(rows.map(key).sort());
  });
});
