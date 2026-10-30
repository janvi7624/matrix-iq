import { isIsoDate } from './dailyReportTime';

// "This person is away — don't warn them for it."
//
// The department manager's own leave marking, as distinct from the
// employee's retrospective "I was on leave" claim (createClaim) which goes
// to HR to decide. A manager marking their own team member's absence IS the
// decision: they are the person who knows, and routing it through an
// approval would mean the warning fires while HR catches up.
//
// So a marked leave is stored as an APPROVED leave claim whose reviewer is
// the manager — which means every existing consumer already does the right
// thing with it: loadLeaveCoveredKeys excuses the date, the sweep skips it,
// HR's queue shows it as settled rather than as a to-do, and the partial
// unique index still allows only one live claim per date.
//
// Pure: no db imports, so the rules are testable and the UI can apply the
// same ones before offering the action.

/**
 * How far ahead a manager may mark leave.
 *
 * Future dates are allowed on purpose — a manager usually knows about an
 * absence before the reporting deadline passes, and the whole point is to
 * get ahead of the warning rather than waive one afterwards. Bounded so a
 * mistyped year cannot excuse somebody indefinitely.
 */
export const MANAGER_LEAVE_MAX_DAYS_AHEAD = 90;

export interface ManagerLeaveInput {
  reportDate: string;
  reason: string;
}

export type ManagerLeaveValidation =
  | { ok: true; reportDate: string; reason: string; isFuture: boolean }
  | { ok: false; error: string };

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export function validateManagerLeaveMark(input: ManagerLeaveInput, todayIst: string): ManagerLeaveValidation {
  const reportDate = (input.reportDate || '').trim();
  if (!isIsoDate(reportDate)) return { ok: false, error: 'A valid reporting date is required.' };

  const reason = (input.reason || '').trim();
  // Required, because this waives an obligation and may waive a warning
  // already recorded — "why" is the only thing that makes that reviewable
  // later. The employee sees it too.
  if (!reason) return { ok: false, error: 'Give a reason — the person on leave and HR both see it.' };
  if (reason.length > 2000) return { ok: false, error: 'Keep the reason under 2000 characters.' };

  const ahead = daysBetween(todayIst, reportDate);
  if (ahead > MANAGER_LEAVE_MAX_DAYS_AHEAD) {
    return { ok: false, error: `Leave can be marked up to ${MANAGER_LEAVE_MAX_DAYS_AHEAD} days ahead. Check the date.` };
  }

  return { ok: true, reportDate, reason, isFuture: ahead > 0 };
}

/**
 * Whether the Mark Leave action belongs on a team row.
 *
 * Not offered when a live claim already covers the date — the date is
 * already excused, so a second marking would only collide with the unique
 * index — and not offered for a report that has actually been filed, where
 * marking leave would contradict the submission sitting next to it.
 */
export function canOfferMarkLeave(row: { leave_status?: string | null; report_id?: string | null }, canFileForOthers: boolean): boolean {
  if (!canFileForOthers) return false;
  if (row.report_id) return false;
  const live = (row.leave_status || '').toUpperCase();
  return live !== 'PENDING' && live !== 'APPROVED';
}
