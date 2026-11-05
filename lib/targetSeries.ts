import { listPeriodOptions } from './targetPeriod';
import { findMonthAmounts } from './salesTargetStore';
import { computeMonthlyAchievement } from './salesAchievement';

// The 12-month Target vs Achieved series behind the Performance Review
// chart. The tiles beside it answer "how is this person doing in the current
// period"; one period is noise, so this answers the question a review
// actually turns on — the trajectory across the fiscal year.
//
// Targets come from the monthly rows the Targets screen writes
// (lib/salesTargetStore.ts) and achievement from the single authoritative
// calculation (lib/salesAchievement.ts), so this introduces no third opinion
// about either number: it only lines them up month by month.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TargetSeriesPoint {
  /** 'YYYY-MM', the same key the monthly target rows are stored under. */
  key: string;
  /** Axis label, e.g. 'Apr 25'. */
  label: string;
  /** Tooltip label, e.g. 'April 2025'. */
  fullLabel: string;
  /**
   * Planned amount, or null for a month with no target. Null rather than 0
   * for the same reason achieved is: a zero plots as a floor the person
   * crashed through, when in fact nothing was ever asked of them that month.
   * A stored 0 counts as "none set" — computeStatus in lib/salesAchievement.ts
   * already treats it that way (it returns not_started), and the Targets
   * screen writes a 0 row for every month left blank.
   */
  target: number | null;
  /**
   * Closed amount, or null for a month that has not started. Null rather
   * than 0 on purpose: a zero would draw a future month as a total miss.
   */
  achieved: number | null;
  /** Achieved as a % of target; null when either side is unknown. */
  achievementPercent: number | null;
  state: 'past' | 'current' | 'future';
}

export interface MonthlyTargetSeries {
  fiscalYear: string;
  points: TargetSeriesPoint[];
  /** Totals across months that have actually started. */
  totals: { target: number; achieved: number; achievementPercent: number };
  /** Full-year planned total, future months included. */
  annualTarget: number;
  hasAnyTarget: boolean;
  hasAnyAchievement: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function localYmd(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shortLabel(key: string): string {
  const [year, month] = key.split('-');
  const name = MONTH_SHORT[Number(month) - 1] ?? month;
  return `${name} ${year.slice(2)}`;
}

/**
 * Pure assembly, kept separate from the two queries above it so the shape of
 * the series can be tested without a database — the same split
 * lib/targetProgress.ts uses.
 */
export function assembleTargetSeries(
  fiscalYear: string,
  months: { key: string; label: string; periodStart: string; periodEnd: string }[],
  monthTargets: Record<string, number>,
  monthAchieved: Record<string, number>,
  now: Date = new Date()
): MonthlyTargetSeries {
  const today = localYmd(now);

  const points: TargetSeriesPoint[] = months.map((month) => {
    const state: TargetSeriesPoint['state'] =
      month.periodStart > today ? 'future' : month.periodEnd < today ? 'past' : 'current';
    const rawTarget = round2(Number(monthTargets[month.key]) || 0);
    const target = rawTarget > 0 ? rawTarget : null;
    const achieved = state === 'future' ? null : round2(Number(monthAchieved[month.key]) || 0);
    return {
      key: month.key,
      label: shortLabel(month.key),
      fullLabel: month.label,
      target,
      achieved,
      achievementPercent: achieved === null || target === null ? null : Math.round((achieved / target) * 100),
      state
    };
  });

  const started = points.filter((p) => p.achieved !== null);
  const totalTarget = round2(started.reduce((sum, p) => sum + (p.target ?? 0), 0));
  const totalAchieved = round2(started.reduce((sum, p) => sum + (p.achieved ?? 0), 0));

  return {
    fiscalYear,
    points,
    totals: {
      target: totalTarget,
      achieved: totalAchieved,
      achievementPercent: totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0
    },
    annualTarget: round2(points.reduce((sum, p) => sum + (p.target ?? 0), 0)),
    hasAnyTarget: points.some((p) => p.target !== null),
    hasAnyAchievement: started.some((p) => (p.achieved ?? 0) > 0)
  };
}

export async function buildMonthlyTargetSeries(
  employeeId: string,
  fiscalYear: string,
  now: Date = new Date()
): Promise<MonthlyTargetSeries> {
  const months = listPeriodOptions('monthly', fiscalYear);
  const [monthTargets, monthAchieved] = await Promise.all([
    findMonthAmounts(employeeId, fiscalYear),
    computeMonthlyAchievement(employeeId, months)
  ]);
  return assembleTargetSeries(fiscalYear, months, monthTargets, monthAchieved, now);
}
