import { computeStatus, TargetStatus } from './salesAchievement';

// "How am I doing against my target, right now" — the arithmetic behind the
// rep's own dashboard panel, kept pure so it can be tested without a
// database and so the server and any future client render agree.
//
// `expectedPercent` is the honest half of the picture: 40% of the target on
// day 3 of a month is ahead; the same 40% on day 27 is behind. computeStatus
// already encodes that comparison as a label — this exposes the number it
// compares against, so the UI can show the two side by side instead of
// making the reader guess why it says "At Risk".
export interface TargetProgress {
  targetAmount: number;
  achievedAmount: number;
  /** Achieved as a % of target. Can exceed 100; 0 when no target is set. */
  achievementPercent: number;
  /** What is still to be earned. Never negative — an exceeded target leaves 0. */
  remainingAmount: number;
  status: TargetStatus;
  daysTotal: number;
  /** Days of the period already gone, counting today as elapsed. */
  daysElapsed: number;
  /** Days remaining INCLUDING today. 0 once the period has ended. */
  daysLeft: number;
  /** How far through the period we are, as a %. The pace to beat. */
  expectedPercent: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayStart(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildTargetProgress(
  targetAmount: number,
  achievedAmount: number,
  periodStart: string,
  periodEnd: string,
  now: Date = new Date()
): TargetProgress {
  const start = dayStart(periodStart);
  const end = dayStart(periodEnd);
  const today = dayStart(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  );

  // Inclusive of both ends: April 1-30 is 30 days, not 29.
  const daysTotal = Math.round((end - start) / DAY_MS) + 1;
  const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((today - start) / DAY_MS) + 1));
  const daysLeft = Math.max(0, daysTotal - daysElapsed);

  return {
    targetAmount: round2(targetAmount),
    achievedAmount: round2(achievedAmount),
    achievementPercent: targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0,
    remainingAmount: round2(Math.max(0, targetAmount - achievedAmount)),
    status: computeStatus(targetAmount, achievedAmount, periodStart, periodEnd, now),
    daysTotal,
    daysElapsed,
    daysLeft,
    expectedPercent: daysTotal > 0 ? Math.round((daysElapsed / daysTotal) * 100) : 0
  };
}
