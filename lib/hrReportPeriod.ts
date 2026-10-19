// What a "period" means for the HR expense report, and which periods the
// pickers are allowed to offer.
//
// Split out of HrReportsView so the floor below is testable. It is pure date
// arithmetic with no React in it, and its failure mode is silent — a period
// this module declines to offer is a period whose expenses nobody can see —
// so it is worth pinning down in tests rather than eyeballing in the UI.

export type Granularity = 'month' | 'quarter' | 'year';

// 'all' = every bucket in the selected year; otherwise one specific month
// (1-12) or quarter (1-4). What the picker offers follows the granularity,
// which is the whole point: a monthly report asks you for a month, a
// quarterly one for a quarter, and a yearly one for nothing but the year.
export type PeriodScope = 'all' | number;

// The window the pickers offer, derived from the DATA rather than hardcoded.
//
// This used to be a pair of constants (DATA_START_YEAR / DATA_START_MONTH)
// that a developer had to lower by hand whenever somebody back-dated an
// entry. Its failure mode is silent — a period this module declines to offer
// is a period whose expenses nobody can see, with nothing on screen to
// suggest anything is missing — and it had already failed twice:
//
//   1. It said July 2026 while Office Operation had entries from 2026-04-30,
//      hiding a quarter of a year of real spend.
//   2. It was corrected to April 2026, then Office Operation gained a
//      2026-01-14 entry, hiding January again. Meanwhile the CEILING, which
//      stopped at the month in progress, was hiding ~6.6 lakh of
//      future-dated November and December reimbursements.
//
// Both ends now come from min(date)/max(date) across the two tables that
// feed this report (see getExpenseDataBounds in hrExpenseReportStore.ts), so
// a back-dated or forward-dated entry becomes reachable the moment it is
// saved, with no code change and no third incident.

export interface PeriodBounds {
  min: { year: number; month: number };
  max: { year: number; month: number };
}

// Used only when the bounds query fails or there is no spend at all. Kept
// deliberately narrow: an over-wide fallback would open the report with
// years of guaranteed-empty columns.
export const FALLBACK_BOUNDS: PeriodBounds = {
  min: { year: 2026, month: 1 },
  max: { year: 2026, month: 12 }
};

export const DATA_START_YEAR = FALLBACK_BOUNDS.min.year;

// The first month that exists for a given year — the data floor for the
// earliest year with spend, January for every year after it.
export function firstMonthOf(year: number, bounds: PeriodBounds = FALLBACK_BOUNDS): number {
  return year === bounds.min.year ? bounds.min.month : 1;
}

// Every year a picker should offer: from the earliest year with spend up to
// the later of the current year and the last year with spend. The second
// half matters — a forward-dated entry must not be unreachable just because
// its year has not arrived.
export function selectableYears(now: { year: number; month: number }, bounds: PeriodBounds = FALLBACK_BOUNDS): number[] {
  const last = Math.max(now.year, bounds.max.year);
  const count = Math.max(1, last - bounds.min.year + 1);
  return Array.from({ length: count }, (_, i) => last - i);
}

// The last month worth reporting on for a given year: the later of the
// month in progress and the last month that actually holds data.
//
// Taking the LATER of the two is the fix for the second silent gap — capping
// at the month in progress hid future-dated entries that already exist.
// Reporting on a month that has not happened is harmless when it is empty;
// hiding one that has spend in it is not.
export function lastMonthOf(year: number, now: { year: number; month: number }, bounds: PeriodBounds = FALLBACK_BOUNDS): number {
  // How far data reaches within this year.
  const dataLast = year < bounds.max.year ? 12 : year === bounds.max.year ? bounds.max.month : 0;
  // How far the calendar reaches within this year.
  const calendarLast = year < now.year ? 12 : year === now.year ? now.month : 0;
  return Math.min(12, Math.max(1, dataLast, calendarLast));
}

export function monthIsSelectable(month: number, year: number, now: { year: number; month: number }, bounds: PeriodBounds = FALLBACK_BOUNDS): boolean {
  return month >= firstMonthOf(year, bounds) && month <= lastMonthOf(year, now, bounds);
}

// A quarter is offered when it OVERLAPS the open window, not when it sits
// wholly inside it: Q2 of the first year is worth reporting on even though
// the floor starts partway through it, and so is the quarter in progress.
export function quarterIsSelectable(quarter: number, year: number, now: { year: number; month: number }, bounds: PeriodBounds = FALLBACK_BOUNDS): boolean {
  return quarter * 3 >= firstMonthOf(year, bounds) && (quarter - 1) * 3 + 1 <= lastMonthOf(year, now, bounds);
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Day 0 of the following month is the last day of this one — no
// days-per-month or leap-year table needed.
function lastDayOf(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// The picker's (year, granularity, scope) turned into the from/to range the
// API already speaks, so the server keeps one date-range contract and the
// UI decides what a "period" means. Both ends are clamped: no earlier than
// the first month with data, no later than the month in progress.
export function resolveRange(
  year: number,
  granularity: Granularity,
  scope: PeriodScope,
  now: { year: number; month: number },
  bounds: PeriodBounds = FALLBACK_BOUNDS
): { from: string; to: string } {
  const firstMonth = firstMonthOf(year, bounds);
  const lastMonth = lastMonthOf(year, now, bounds);

  if (granularity === 'month' && scope !== 'all') {
    return { from: iso(year, scope, 1), to: iso(year, scope, lastDayOf(year, scope)) };
  }
  if (granularity === 'quarter' && scope !== 'all') {
    const startMonth = (scope - 1) * 3 + 1;
    // The quarter in progress ends at the current month, not at a future
    // quarter-end date.
    const endMonth = Math.min(startMonth + 2, lastMonth);
    return { from: iso(year, startMonth, 1), to: iso(year, endMonth, lastDayOf(year, endMonth)) };
  }
  // Yearly, or "all months"/"all quarters" — everything that has happened
  // this year, which the report then splits into however many buckets the
  // granularity asks for (months, quarters, or the one year).
  return { from: iso(year, firstMonth, 1), to: iso(year, lastMonth, lastDayOf(year, lastMonth)) };
}
