// "HR was told two days ago and nothing has happened."
//
// An escalation used to end at the send: HR got one email and the system
// stopped caring. This is the follow-up — who gets chased, and when.
//
// Pure: no db imports, so the schedule is testable without a clock or a
// database, which matters because every bug in this kind of code is an
// off-by-one in a date comparison.

/** How long HR has to act on an escalation before the manager is told. */
export const HR_ACTION_DUE_DAYS = 2;

/**
 * Hard stop on the chasing.
 *
 * Without one, an escalation nobody ever acknowledges mails the HR manager
 * every two days forever, and a notification that never stops is one people
 * learn to filter. After this many reminders the card still shows as
 * unactioned on the Warnings tab — visible, but no longer shouting.
 */
export const HR_REMINDER_MAX = 3;

export interface PendingEscalation {
  id: string;
  employeeId: string;
  employeeName: string;
  monthKey: string;
  warningCount: number;
  /** When HR was told. Null means the send never completed. */
  notifiedAt: Date | null;
  acknowledgedAt: Date | null;
  reminderLastSentAt: Date | null;
  reminderCount: number;
}

export interface PlannedReminder {
  escalationId: string;
  /** The subject of the escalation — excluded from the chase if they are a recipient. */
  employeeId: string;
  employeeName: string;
  monthKey: string;
  warningCount: number;
  /** Whole days since HR was notified, for the message. */
  daysWaiting: number;
  /** 1 for the first chase, 2 for the second, and so on. */
  reminderNumber: number;
  /** The count BEFORE this chase, so the stamp is a plain increment. */
  previousReminderCount: number;
}

const DAY_MS = 86_400_000;

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Which escalations should chase the HR manager right now.
 *
 * The rule, in order:
 *   * Never chase one that was never successfully sent — the problem there is
 *     delivery, not HR, and the admin log already shows it.
 *   * Never chase an acknowledged one. This is what makes the reminder stop,
 *     and why acknowledgement had to be an explicit act rather than inferred
 *     from a waiver.
 *   * First chase at dueDays after notification; each later one dueDays after
 *     the previous chase, so the interval is the same whichever it is.
 *   * Stop after HR_REMINDER_MAX.
 */
export function planEscalationReminders(
  escalations: PendingEscalation[],
  now: Date,
  dueDays: number = HR_ACTION_DUE_DAYS,
  maxReminders: number = HR_REMINDER_MAX
): PlannedReminder[] {
  const planned: PlannedReminder[] = [];

  for (const escalation of escalations) {
    if (!escalation.notifiedAt) continue;
    if (escalation.acknowledgedAt) continue;
    if (escalation.reminderCount >= maxReminders) continue;

    // The clock runs from the last thing that was said about it — the
    // original notification, or the most recent chase.
    const since = escalation.reminderLastSentAt ?? escalation.notifiedAt;
    if (wholeDaysBetween(since, now) < dueDays) continue;

    planned.push({
      escalationId: escalation.id,
      employeeId: escalation.employeeId,
      employeeName: escalation.employeeName,
      monthKey: escalation.monthKey,
      warningCount: escalation.warningCount,
      daysWaiting: wholeDaysBetween(escalation.notifiedAt, now),
      reminderNumber: escalation.reminderCount + 1,
      previousReminderCount: escalation.reminderCount
    });
  }

  return planned;
}

/** The chase, in words. Says what is pending and how long it has been. */
export function reminderMessage(reminder: PlannedReminder, threshold: number): { title: string; body: string } {
  const days = reminder.daysWaiting === 1 ? '1 day' : `${reminder.daysWaiting} days`;
  return {
    title: `Action still pending — ${reminder.employeeName}`,
    body:
      `${reminder.employeeName} reached ${reminder.warningCount} missed-report warnings in ${reminder.monthKey} ` +
      `(the limit is ${threshold}). HR was notified ${days} ago and nobody has recorded an action yet. ` +
      `Open HR › Daily Report Review and record what was done — waiving a warning is not required, a note is.`
  };
}
