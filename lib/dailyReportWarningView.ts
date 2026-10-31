import { DailyReportWarningGroup, DailyReportWarningRecord } from './dailyReportTypes';

// What HR actually needs to see on the Warnings tab: the one warning that
// asks something of them, not the running tally that led to it.
//
// The tab used to list every warning date for everybody with at least one —
// so a person on their first missed report looked much like a person who had
// hit the threshold, and the date that actually triggered escalation was
// just another chip in a row of chips. HR's job here is the employee who has
// reached the limit; the earlier dates are context, not work.
//
// Pure: no db imports, so the UI and its tests share these rules.

/**
 * The warning that represents where this employee now stands: the most
 * recent ACTIVE one.
 *
 * Latest rather than Nth, because waivers make "the 4th warning" ambiguous —
 * if HR waives the second of four, the employee is back under the threshold
 * and the last remaining active warning is the one that matters. Sorting by
 * date and taking the end is right under every combination of waivers.
 */
export function finalActiveWarning(warnings: DailyReportWarningRecord[]): DailyReportWarningRecord | null {
  const active = warnings.filter((w) => w.status === 'ACTIVE');
  if (!active.length) return null;
  return active.reduce((latest, w) => (w.report_date > latest.report_date ? w : latest), active[0]);
}

/** The active warnings before the final one — context, shown collapsed. */
export function earlierActiveWarnings(warnings: DailyReportWarningRecord[]): DailyReportWarningRecord[] {
  const final = finalActiveWarning(warnings);
  if (!final) return [];
  return warnings
    .filter((w) => w.status === 'ACTIVE' && w.id !== final.id)
    .sort((a, b) => a.report_date.localeCompare(b.report_date));
}

/**
 * Whether this employee is asking HR to do something right now — at or past
 * the threshold, or already escalated.
 *
 * The same rule listWarningGroups applies for view=escalated, restated here
 * so the card can label itself without a second round trip and without the
 * UI inventing its own definition of "needs action".
 */
export function needsHrAction(group: Pick<DailyReportWarningGroup, 'active_warnings' | 'hr_escalated'>, threshold: number): boolean {
  return group.hr_escalated || group.active_warnings >= threshold;
}

/**
 * The headline for the final warning: "Final warning · 4 of 4" when the
 * threshold is reached, and the plainer "Latest warning · 2 of 4" when it is
 * not — so the strong words only appear when they are true.
 */
export function finalWarningHeadline(
  group: Pick<DailyReportWarningGroup, 'active_warnings' | 'hr_escalated'>,
  threshold: number
): string {
  const count = `${group.active_warnings} of ${threshold}`;
  return needsHrAction(group, threshold) ? `Final warning · ${count}` : `Latest warning · ${count}`;
}
