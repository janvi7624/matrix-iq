import { buildPeriod, listPeriodOptions, TargetPeriodType } from './targetPeriod';

// The MONTH is the only figure anybody enters. A fiscal year's quarters,
// halves and the year itself are the SUM of their months — never an even
// spread of one rate.
//
// This replaces lib/targetCascade.ts, which did the opposite: one figure was
// treated as a rate and pushed down to every period, so all 12 months of a
// year necessarily carried the same number. Real monthly targets differ month
// to month (seasonality, a rep joining mid-year, a quarter with a trade show
// in it), and that model could not express it — setting April to 2L forced
// May to 2L as well. Now April can be 2L, May 3L, and Q1 is simply their sum.
//
// Pure arithmetic over the FY calendar, no DB access, so the API and the
// dialog's live preview compute identical figures from the same function.

export const MONTHS_IN_PERIOD: Record<TargetPeriodType, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12
};

export const ROLLUP_PERIOD_TYPES: TargetPeriodType[] = ['monthly', 'quarterly', 'half_yearly', 'annual'];

// Quarterly/half-yearly/annual rows are derived — the UI shows them read-only
// and the API refuses to have them edited directly.
export const DERIVED_PERIOD_TYPES: TargetPeriodType[] = ['quarterly', 'half_yearly', 'annual'];

// Month amounts keyed the way buildPeriod keys a month: 'YYYY-MM'. A missing
// or zero month means no target that month, which is a legitimate entry (a
// rep who starts in July has no April target) — not a gap to be filled in.
export type MonthAmounts = Record<string, number>;

export interface RolledUpTarget {
  periodType: TargetPeriodType;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  displayPeriod: string;
  fiscalYear: string;
  targetAmount: number;
}

export interface RollupSummary {
  // Keyed 'YYYY-MM', in April-first fiscal order.
  months: { key: string; label: string; amount: number }[];
  quarters: { key: string; label: string; amount: number }[];
  halves: { key: string; label: string; amount: number }[];
  annual: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// The 12 month keys of a fiscal year, April first. The single source for
// "which months exist in this FY" — the form grid, the API's key validation
// and the rollup all read it, so none of them can disagree about March.
export function fiscalYearMonthKeys(fiscalYear: string): string[] {
  return listPeriodOptions('monthly', fiscalYear).map((o) => o.key);
}

export function normalizeMonthAmounts(fiscalYear: string, months: MonthAmounts): MonthAmounts {
  const out: MonthAmounts = {};
  for (const key of fiscalYearMonthKeys(fiscalYear)) {
    const value = Number(months[key]);
    out[key] = Number.isFinite(value) && value > 0 ? round2(value) : 0;
  }
  return out;
}

// Which months fall inside an arbitrary period of this FY. Done by date range
// rather than by hardcoding "Q1 is months 0-2", so Q4/H2 spilling into the
// next calendar year (Jan-Mar) needs no special case here — buildPeriod
// already knows where they start and end.
function monthKeysWithin(fiscalYear: string, periodStart: string, periodEnd: string): string[] {
  return listPeriodOptions('monthly', fiscalYear)
    .filter((m) => m.periodStart >= periodStart && m.periodEnd <= periodEnd)
    .map((m) => m.key);
}

export function sumMonths(fiscalYear: string, months: MonthAmounts, periodStart: string, periodEnd: string): number {
  return round2(
    monthKeysWithin(fiscalYear, periodStart, periodEnd).reduce((total, key) => total + (Number(months[key]) || 0), 0)
  );
}

// Every period of the fiscal year — 12 months as entered, then 4 quarters, 2
// halves and the year as sums of them. Exactly the same 19 rows the old
// cascade wrote, so nothing downstream (the roster table, the achievement
// comparison, the unique index) changes shape; only the amounts are now
// additive rather than identical.
export function buildTargetsFromMonths(fiscalYear: string, months: MonthAmounts): RolledUpTarget[] {
  const normalized = normalizeMonthAmounts(fiscalYear, months);
  const out: RolledUpTarget[] = [];

  for (const periodType of ROLLUP_PERIOD_TYPES) {
    for (const option of listPeriodOptions(periodType, fiscalYear)) {
      const period = buildPeriod(periodType, fiscalYear, option.key || undefined);
      out.push({
        periodType,
        periodKey: period.periodKey,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        displayPeriod: period.displayPeriod,
        fiscalYear,
        targetAmount:
          periodType === 'monthly'
            ? normalized[period.periodKey] ?? 0
            : sumMonths(fiscalYear, normalized, period.periodStart, period.periodEnd)
      });
    }
  }

  return out;
}

// What the 12 entered months roll up to at each scale — previewed live in the
// form, so nobody has to save to find out what Q2 just became, and echoed by
// the API so the caller can report it.
export function rollupSummary(fiscalYear: string, months: MonthAmounts): RollupSummary {
  const normalized = normalizeMonthAmounts(fiscalYear, months);
  const at = (periodType: TargetPeriodType) =>
    listPeriodOptions(periodType, fiscalYear).map((o) => ({
      key: o.key,
      label: o.label,
      amount: sumMonths(fiscalYear, normalized, o.periodStart, o.periodEnd)
    }));

  const year = buildPeriod('annual', fiscalYear);
  return {
    months: listPeriodOptions('monthly', fiscalYear).map((o) => ({ key: o.key, label: o.label, amount: normalized[o.key] ?? 0 })),
    quarters: at('quarterly'),
    halves: at('half_yearly'),
    annual: sumMonths(fiscalYear, normalized, year.periodStart, year.periodEnd)
  };
}
