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

// The earliest period the pickers offer, so a whole-year range doesn't open
// with guaranteed-empty columns.
//
// This is a HARD FLOOR, and its failure mode is silent: any entry dated
// before it is simply unreachable — the month is not offered, the quarter
// containing it is not offered, and a yearly range starts after it. That is
// exactly what went wrong once already. It said July 2026, on the basis that
// no register held anything earlier, but Office Operation has entries from
// 2026-04-30, so a quarter of a year of real spend was missing from the
// report with nothing on screen to suggest it.
//
// Only two tables feed this report — reimbursements (which carries both
// Reimbursement and Admin Expense, separated by a flag) and
// office_operation_expenses. Their true minimum dates as of this change:
//   reimbursements             2026-07-07
//   office_operation_expenses  2026-04-30  <- the binding one
//
// If spend is ever back-dated earlier than this again, lower it. To check:
//   select min(date) from reimbursements;
//   select min(date) from office_operation_expenses;
export const DATA_START_YEAR = 2026;
export const DATA_START_MONTH = 4;

// The first month that exists for a given year — the floor above for the
// first year with data, January for every year after it.
export function firstMonthOf(year: number): number {
  return year === DATA_START_YEAR ? DATA_START_MONTH : 1;
}

// The last month worth reporting on for a given year: the month in progress
// for the current year, December for any year already finished. Capping here
// is what keeps months that haven't happened out of the table — and what
// makes a new one appear on its own the day it begins, with no code change.
export function lastMonthOf(year: number, now: { year: number; month: number }): number {
  return year === now.year ? now.month : 12;
}

export function monthIsSelectable(month: number, year: number, now: { year: number; month: number }): boolean {
  return month >= firstMonthOf(year) && month <= lastMonthOf(year, now);
}

// A quarter is offered when it OVERLAPS the open window, not when it sits
// wholly inside it: Q2 of the first year is worth reporting on even though
// the floor starts partway through it, and so is the quarter in progress.
export function quarterIsSelectable(quarter: number, year: number, now: { year: number; month: number }): boolean {
  return quarter * 3 >= firstMonthOf(year) && (quarter - 1) * 3 + 1 <= lastMonthOf(year, now);
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
  now: { year: number; month: number }
): { from: string; to: string } {
  const firstMonth = firstMonthOf(year);
  const lastMonth = lastMonthOf(year, now);

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
