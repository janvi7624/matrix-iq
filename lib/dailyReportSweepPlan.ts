// What the scheduler should do right now — decided as a pure function.
//
// The brief's hard requirements for this engine are all idempotency and
// ordering requirements ("make every scheduled operation idempotent",
// "prevent duplicate reminders, warnings and HR escalations during retries",
// "reconcile missed scheduler executions safely after a restart",
// "recheck submission and leave status immediately before recording a
// warning"). Those are exactly the properties that are miserable to verify
// against a live database and trivial to verify against a function, so the
// decision is separated from the doing: this file decides, and
// lib/dailyReportScheduler.ts loads the state, calls this, and performs the
// side effects inside the same ledger-guarded transaction.
//
// Pure: no DB, no clock of its own (`now` is always passed in), no I/O.

import { DeadlinePolicy, monthKey, scheduleFor, workingDaysBetween } from './dailyReportTime';

/**
 * The three time-triggered events, in the order they fire for one reporting
 * date. Stored verbatim in daily_report_notification_events.event_key, which
 * is what makes a retry a no-op.
 */
export type SweepEventKind = 'REMINDER_EVENING' | 'REMINDER_FINAL' | 'WARNING';

export const SWEEP_EVENT_KINDS: SweepEventKind[] = ['REMINDER_EVENING', 'REMINDER_FINAL', 'WARNING'];

/** One eligible employee owing one reporting date. */
export interface SweepSubject {
  employeeId: string;
  reportDate: string;
}

export function subjectKey(employeeId: string, reportDate: string): string {
  return `${employeeId}|${reportDate}`;
}

export function eventKey(employeeId: string, reportDate: string, kind: SweepEventKind): string {
  return `${employeeId}|${reportDate}|${kind}`;
}

/**
 * Everything already true in the database, as membership sets. Sets rather
 * than queries so the planner can't issue an N+1 and can't see a different
 * answer than the executor did a moment earlier.
 */
export interface SweepState {
  /**
   * subjectKey for every report that is actually SUBMITTED (on time or
   * late). A DRAFT is deliberately absent: the brief is explicit that a
   * saved draft neither satisfies the filing requirement nor suppresses a
   * reminder, which is the whole reason draft and submitted are separate
   * statuses.
   */
  submitted: Set<string>;
  /**
   * subjectKey for every date covered by a leave claim that is PENDING or
   * APPROVED. Pending counts: the date is "temporarily excluded from new
   * reminders and warnings while the claim is pending" per the workflow, so
   * nobody is nagged while HR is still deciding.
   */
  leaveCovered: Set<string>;
  /** eventKey for every event already recorded — the idempotency ledger. */
  sent: Set<string>;
}

export interface PlannedEvent {
  kind: SweepEventKind;
  employeeId: string;
  reportDate: string;
  /** When this event became due. Past-dated for a catch-up after downtime. */
  dueAt: Date;
  /** True when it fired later than its scheduled minute — surfaced in admin logs. */
  late: boolean;
}

/** Anything more than this behind schedule is reported as a catch-up. */
const LATE_FIRE_TOLERANCE_MS = 15 * 60_000;

/**
 * The events that are due and not yet done.
 *
 * Reconciliation after downtime falls out of the design rather than needing
 * its own code path: the caller passes a WINDOW of reporting dates (not just
 * today), every due event whose ledger row is missing is returned, and the
 * ledger stops anything already done from being repeated. A sweep that has
 * not run for three days therefore catches up on exactly what it missed the
 * first time it runs again, and a sweep that runs twice in the same minute
 * does nothing the second time.
 */
export function planSweep(subjects: SweepSubject[], state: SweepState, now: Date, policy: DeadlinePolicy): PlannedEvent[] {
  const planned: PlannedEvent[] = [];
  const nowMs = now.getTime();

  for (const subject of subjects) {
    const key = subjectKey(subject.employeeId, subject.reportDate);

    // Both of these are rechecked here, immediately before the warning is
    // planned, rather than being assumed from an earlier pass — a report
    // submitted at 10:59 and a leave claim raised at 10:58 must both still
    // count.
    if (state.submitted.has(key)) continue;
    if (state.leaveCovered.has(key)) continue;

    const schedule = scheduleFor(subject.reportDate, policy);
    const due: { kind: SweepEventKind; at: Date }[] = [
      { kind: 'REMINDER_EVENING', at: schedule.eveningReminderAt },
      { kind: 'REMINDER_FINAL', at: schedule.finalReminderAt },
      { kind: 'WARNING', at: schedule.deadlineAt }
    ];

    for (const event of due) {
      if (event.at.getTime() > nowMs) continue;
      if (state.sent.has(eventKey(subject.employeeId, subject.reportDate, event.kind))) continue;
      planned.push({
        kind: event.kind,
        employeeId: subject.employeeId,
        reportDate: subject.reportDate,
        dueAt: event.at,
        late: nowMs - event.at.getTime() > LATE_FIRE_TOLERANCE_MS
      });
    }
  }

  // Oldest first, so a catch-up run sends Monday's missed reminder before
  // Tuesday's and an employee's inbox reads in chronological order.
  return planned.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.employeeId.localeCompare(b.employeeId) || a.kind.localeCompare(b.kind));
}

/**
 * The reporting dates a sweep should consider: every working day from
 * `windowDays` ago up to today, in IST.
 *
 * The window is what makes the job self-healing. It is bounded (rather than
 * "every date since the module launched") so that enabling the scheduler, or
 * restoring a backup, cannot retroactively warn people for months of dates
 * nobody was ever reminded about — the brief's "do not silently create
 * backdated warnings" concern applied to the scheduler itself.
 */
export function sweepWindow(now: Date, windowDays: number, policy: DeadlinePolicy): string[] {
  const to = istDateOf(now);
  const from = addCalendarDays(to, -Math.max(0, windowDays));
  return workingDaysBetween(from, to, policy);
}

// Tiny local helpers so this file's only dependency on dailyReportTime.ts is
// the pure arithmetic it already exports.
function istDateOf(instant: Date): string {
  const shifted = new Date(instant.getTime() + 330 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Warnings → HR escalation
// ---------------------------------------------------------------------------

export interface PlannedEscalation {
  employeeId: string;
  monthKey: string;
  activeWarnings: number;
}

/**
 * Who crosses the threshold this month and has not already been escalated.
 *
 * Two separate rules, and they are easy to conflate: warnings keep being
 * recorded indefinitely, but only ONE escalation email per employee per
 * calendar month ever goes out. The cap is enforced by the caller's unique
 * (employee_id, month_key) row — `alreadyEscalated` is that table — not by
 * counting emails, so a retry mid-send can't produce a second one.
 *
 * `activeByEmployeeMonth` must already exclude waived warnings: a waived
 * warning stays in history but is not an active warning, so waiving the
 * third one takes someone back below the threshold.
 */
export function planEscalations(
  activeByEmployeeMonth: Map<string, number>,
  alreadyEscalated: Set<string>,
  threshold: number
): PlannedEscalation[] {
  const planned: PlannedEscalation[] = [];
  for (const [key, count] of activeByEmployeeMonth) {
    if (count < threshold) continue;
    if (alreadyEscalated.has(key)) continue;
    const [employeeId, month] = key.split('|');
    planned.push({ employeeId, monthKey: month, activeWarnings: count });
  }
  return planned.sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.employeeId.localeCompare(b.employeeId));
}

export function escalationKey(employeeId: string, month: string): string {
  return `${employeeId}|${month}`;
}

export function escalationKeyForDate(employeeId: string, reportDate: string): string {
  return escalationKey(employeeId, monthKey(reportDate));
}

// ---------------------------------------------------------------------------
// The employee-facing banner
// ---------------------------------------------------------------------------

export type WarningBannerTone = 'clear' | 'notice' | 'warning' | 'escalated';

export interface WarningBanner {
  tone: WarningBannerTone;
  /** "1 of 3 missed this month", or "HR informed" once escalated. */
  headline: string;
  detail: string;
}

/**
 * The banner on the employee's own page. Derived here so the page, the
 * manager view and the HR view all describe the same state in the same
 * words — "HR informed" must not appear in one place while another still
 * counts up to three.
 */
export function warningBanner(activeCount: number, threshold: number, escalated: boolean): WarningBanner {
  if (escalated) {
    return {
      tone: 'escalated',
      headline: 'HR informed',
      detail: `${activeCount} missed report${activeCount === 1 ? '' : 's'} this month. HR has been notified. File any outstanding report, or raise a leave claim for the dates you were away.`
    };
  }
  const headline = `${activeCount} of ${threshold} missed this month`;
  if (activeCount === 0) {
    return { tone: 'clear', headline, detail: 'Every working day this month is accounted for. Keep it up.' };
  }
  if (activeCount >= threshold - 1) {
    return {
      tone: 'warning',
      headline,
      detail: `One more missed report this month and HR is informed. If you were on leave on a missed date, raise a leave claim for it.`
    };
  }
  return {
    tone: 'notice',
    headline,
    detail: `${threshold - activeCount} more missed reports this month would inform HR. If you were on leave on a missed date, raise a leave claim for it.`
  };
}

/**
 * Whether the missed dates in a month run back to back — HR asked to be able
 * to tell "away for three days" (likely leave somebody forgot to claim) from
 * "skipped three scattered days" (a habit), and that distinction drives
 * whether they waive or follow up. Dates may arrive in any order.
 */
export function missedDatePattern(dates: string[]): 'none' | 'single' | 'consecutive' | 'scattered' {
  if (!dates.length) return 'none';
  if (dates.length === 1) return 'single';
  const sorted = [...dates].sort();
  for (let i = 1; i < sorted.length; i++) {
    const prev = Date.UTC(Number(sorted[i - 1].slice(0, 4)), Number(sorted[i - 1].slice(5, 7)) - 1, Number(sorted[i - 1].slice(8, 10)));
    const curr = Date.UTC(Number(sorted[i].slice(0, 4)), Number(sorted[i].slice(5, 7)) - 1, Number(sorted[i].slice(8, 10)));
    // Compared on calendar days rather than working days on purpose: a
    // Saturday and the following Monday read as consecutive to a person, and
    // that is who this label is for.
    if (curr - prev > 3 * 86_400_000) return 'scattered';
  }
  return 'consecutive';
}
