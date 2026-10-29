import { Op } from 'sequelize';
import { db } from './db';
import { notifyUsers } from './notificationStore';
import { dailyReportUrl, sendDailyReportEmail } from './email/notifications';
import { DailyReportEmailData, DailyReportEmailKind } from './email/templates/dailyReport';
import { SweepEventKind } from './dailyReportSweepPlan';
import { formatIst } from './dailyReportTime';

// Delivery for the Daily Report module: the in-app bell, the SES email, and
// the ledger that makes both of them exactly-at-most-once.
//
// The ledger is the whole point of this file. Every time-triggered send —
// and the submission notice, which a double-click would otherwise duplicate
// — first CLAIMS a row in daily_report_notification_events keyed on
// (employee, reporting date, event). The unique index means a second attempt
// gets nothing back and sends nothing. The row is written BEFORE the send
// and updated after, so a crash in between loses a notification rather than
// duplicating one: with real staff on the receiving end, silence is the
// recoverable failure and spam is not.
//
// Both channels reuse what the app already has — lib/notificationStore.ts's
// notifyUsers for the bell, lib/email/notifications.ts (AWS SES) for mail.
// Neither is re-implemented here, and neither can throw into a caller: a
// notification failure must never abort the sweep or fail the employee's
// submit.

/**
 * Ledger keys. The three scheduled ones, the submission notice, the Sales/
 * GEM-Sales auto-submit, and the 2-zero-day streak warning.
 */
export type NotificationEventKey = SweepEventKind | 'SUBMITTED' | 'AUTO_SUBMIT' | 'ZERO_TOTAL_WARNING';

export interface ClaimedEvent {
  id: string;
  employeeId: string;
  reportDate: string;
  eventKey: NotificationEventKey;
}

/**
 * Reserves the right to send one notification, or returns null because
 * somebody already has.
 *
 * `dryRun` still claims the row — recorded with status 'dry_run' — so a
 * dry-run sweep is genuinely a rehearsal of the real thing (including its
 * idempotency) and the admin log shows exactly what would have gone out. It
 * does mean a date rehearsed in dry-run is not re-sent for real afterwards,
 * which is why switching dry-run off is documented as something to do on the
 * day you want live sends to begin, not after a week of rehearsals.
 */
export async function claimNotificationEvent(
  employeeId: string,
  reportDate: string,
  eventKey: NotificationEventKey,
  dueAt: Date | null,
  dryRun: boolean
): Promise<ClaimedEvent | null> {
  try {
    const row = await db.DailyReportNotificationEvent.create({
      employee_id: employeeId,
      report_date: reportDate,
      event_key: eventKey,
      due_at: dueAt,
      processed_at: new Date(),
      status: dryRun ? 'dry_run' : 'sent',
      channels: {}
    } as never);
    return { id: row.get('id') as string, employeeId, reportDate, eventKey };
  } catch (error) {
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') return null;
    throw error;
  }
}

/**
 * Frees a stuck claim so a state-changing event can be retried.
 *
 * claimNotificationEvent's unique index has no status scoping — a 'failed'
 * row (a crash, a dropped connection, the process restarting mid-call) is
 * indistinguishable from a successful one to a later claim attempt, which
 * just collides and returns null forever. That is an acceptable trade for a
 * pure NOTIFICATION (REMINDER/WARNING/SUBMITTED): at worst a mail is lost
 * while the state it would have announced is unaffected or separately
 * guarded. It is not acceptable for an event whose claim gates the ONLY
 * path to a state change — AUTO_SUBMIT (the one and only way a report gets
 * auto-filed) and ZERO_TOTAL_WARNING (the one and only way the streak gets
 * flagged) — so those two callers clear a dead 'failed' row before
 * reclaiming, rather than accepting a permanent stuck slot. Never touches a
 * 'sent' or 'dry_run' row — those are done, not stuck.
 */
export async function clearFailedClaim(employeeId: string, reportDate: string, eventKey: NotificationEventKey): Promise<void> {
  await db.DailyReportNotificationEvent.destroy({
    where: { employee_id: employeeId, report_date: reportDate, event_key: eventKey, status: 'failed' } as never
  });
}

export async function recordEventOutcome(
  id: string,
  status: 'sent' | 'skipped' | 'failed' | 'dry_run',
  channels: Record<string, unknown>,
  error?: string
): Promise<void> {
  try {
    await db.DailyReportNotificationEvent.update(
      { status, channels, error: error ?? null } as never,
      { where: { id } as never }
    );
  } catch {
    // The send already happened; failing to annotate its ledger row must not
    // propagate. Worst case the admin log shows the optimistic status.
  }
}

/** Every event already recorded for these employees in a date window. */
export async function loadSentEventKeys(employeeIds: string[], from: string, to: string): Promise<Set<string>> {
  if (!employeeIds.length) return new Set();
  const rows = await db.DailyReportNotificationEvent.findAll({
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } } as never,
    attributes: ['employee_id', 'report_date', 'event_key']
  });
  return new Set(
    rows.map((r) => {
      const date = r.get('report_date');
      const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
      return `${r.get('employee_id') as string}|${iso}|${r.get('event_key') as string}`;
    })
  );
}

// --------------------------------------------------------------------------
// Sending
// --------------------------------------------------------------------------

export interface NotifyTarget {
  /** The user id, where the caller has it — used to recognise self-sends. */
  id?: string;
  username: string;
  name: string;
  email: string;
}

export interface DeliveryResult {
  inApp: boolean;
  email: boolean;
  /** Addresses that had no email on file or that SES refused. */
  emailFailures: string[];
}

interface SendInput {
  kind: DailyReportEmailKind;
  recipients: NotifyTarget[];
  /** Bell notification title/body. */
  title: string;
  body: string;
  /** notificationResolver entity type — must have a RESOLVERS entry. */
  entityType: 'daily_report' | 'daily_report_leave_claim' | 'daily_report_warning' | 'daily_report_reminder' | 'daily_report_escalation' | 'daily_report_edit_request';
  entityId: string;
  /** In-app notification type string, for filtering later. */
  type: string;
  reportDate: string;
  deadlineLabel: string;
  actionPath: string;
  actionLabel?: string;
  employeeName?: string;
  departmentName?: string;
  extra?: Partial<DailyReportEmailData>;
  dryRun: boolean;
}

/**
 * One notification out to one or more people, on both channels.
 *
 * In dry-run nothing leaves the building: the intended recipients are logged
 * to the server log (which is where an administrator verifying a rehearsal
 * looks) and reported back so the admin page can show them, but no bell
 * entry is written and no mail is sent.
 */
export async function deliver(input: SendInput): Promise<DeliveryResult> {
  const recipients = input.recipients.filter((r) => r.username);
  if (!recipients.length) return { inApp: false, email: false, emailFailures: [] };

  if (input.dryRun) {
    console.info(
      `[daily-report][dry-run] would send "${input.kind}" for ${input.reportDate} to ${recipients.map((r) => r.username).join(', ')}`
    );
    return { inApp: false, email: false, emailFailures: [] };
  }

  // notifyUsers never throws and dedupes usernames itself (see
  // lib/notificationStore.ts), so owner === manager can't double up.
  await notifyUsers(
    recipients.map((r) => r.username),
    { title: input.title, body: input.body, type: input.type, entityType: input.entityType, entityId: input.entityId }
  );

  const emailFailures: string[] = [];
  let anyEmail = false;
  for (const recipient of recipients) {
    if (!recipient.email) {
      // Not a failure of the send — there is simply no address on file. The
      // bell notification still reached them.
      emailFailures.push(`${recipient.username} (no email on file)`);
      continue;
    }
    const ok = await sendDailyReportEmail(recipient.email, {
      kind: input.kind,
      name: recipient.name || recipient.username,
      employeeName: input.employeeName,
      departmentName: input.departmentName,
      reportDate: input.reportDate,
      deadlineLabel: input.deadlineLabel,
      actionUrl: dailyReportUrl(input.actionPath),
      actionLabel: input.actionLabel,
      ...input.extra
    });
    if (ok) anyEmail = true;
    else emailFailures.push(recipient.email);
  }

  return { inApp: true, email: anyEmail, emailFailures };
}

export function istLabel(instant: Date): string {
  return formatIst(instant);
}

// --------------------------------------------------------------------------
// The module's specific notifications
// --------------------------------------------------------------------------

export interface SubmissionNotice {
  reportId: string;
  employeeId: string;
  employeeName: string;
  departmentName: string;
  reportDate: string;
  submittedAt: Date;
  deadlineAt: Date;
  late: boolean;
  entryCount: number;
  managers: NotifyTarget[];
}

/**
 * Who is actually told that a report was filed: the department's managers,
 * minus the person whose report it is.
 *
 * A department head files a daily report like everybody else, and
 * resolveReportManagers answers "who manages this department" — so for their
 * OWN report they come back in their own recipient list and get told, by
 * mail and by bell, that they submitted their report. They know; they just
 * clicked the button. Nobody needs announcing to themselves, and a notice
 * that tells you what you have just done teaches people to ignore the whole
 * channel, which is the real cost.
 *
 * Matched on id, not username, because that is what Department Master and
 * the template's extra recipients both carry.
 */
export function submissionRecipients(employeeId: string, managers: NotifyTarget[]): NotifyTarget[] {
  return managers.filter((m) => m.id !== employeeId);
}

/**
 * Tells the department's manager(s) that a report was filed.
 *
 * Guarded by the 'SUBMITTED' ledger row, which is what satisfies "repeated
 * submission requests must not generate duplicate notification events" — a
 * retried request, a double-clicked button and a later edit that re-submits
 * all find the row already there and send nothing.
 */
export async function notifyReportSubmitted(notice: SubmissionNotice): Promise<void> {
  const recipients = submissionRecipients(notice.employeeId, notice.managers);
  // Checked BEFORE the claim: a sole department head filing their own report
  // leaves nobody to tell, and burning the ledger slot on a send that never
  // happens would be indistinguishable from one that did.
  if (!recipients.length) return;
  const claim = await claimNotificationEvent(notice.employeeId, notice.reportDate, 'SUBMITTED', notice.submittedAt, false);
  if (!claim) return;

  const result = await deliver({
    kind: 'submitted',
    recipients: notice.managers,
    title: `Daily report submitted — ${notice.employeeName}`,
    body: `${notice.employeeName} submitted their ${notice.reportDate} daily report${notice.late ? ' after the deadline' : ''}.`,
    entityType: 'daily_report',
    entityId: notice.reportId,
    type: 'daily_report_submitted',
    reportDate: notice.reportDate,
    deadlineLabel: formatIst(notice.deadlineAt),
    actionPath: `/daily-reports?tab=team&date=${notice.reportDate}&report=${notice.reportId}`,
    employeeName: notice.employeeName,
    departmentName: notice.departmentName,
    extra: { submittedAtLabel: formatIst(notice.submittedAt), late: notice.late, entryCount: notice.entryCount },
    dryRun: false
  });
  await recordEventOutcome(claim.id, result.inApp || result.email ? 'sent' : 'skipped', { inApp: result.inApp, email: result.email, failures: result.emailFailures });
}

export interface LeaveClaimNotice {
  claimId: string;
  employeeId: string;
  employeeName: string;
  departmentName: string;
  reportDate: string;
  reason: string;
  deadlineAt: Date;
  hrRecipients: NotifyTarget[];
}

export async function notifyLeaveClaimRaised(notice: LeaveClaimNotice): Promise<void> {
  if (!notice.hrRecipients.length) {
    // Worth a loud log rather than silence: a claim nobody can see will sit
    // PENDING forever, suppressing warnings for that date indefinitely.
    console.error(
      `[daily-report] Leave claim ${notice.claimId} for ${notice.reportDate} was raised but no HR manager is configured in Department Master — nobody has been notified.`
    );
    return;
  }
  await deliver({
    kind: 'leave_claim',
    recipients: notice.hrRecipients,
    title: `Leave claim — ${notice.employeeName}, ${notice.reportDate}`,
    body: `${notice.employeeName} has claimed leave for ${notice.reportDate} and asked for the daily report to be exempted.`,
    entityType: 'daily_report_leave_claim',
    entityId: notice.claimId,
    type: 'daily_report_leave_claim',
    reportDate: notice.reportDate,
    deadlineLabel: formatIst(notice.deadlineAt),
    actionPath: `/hr/daily-reports?tab=leave&claim=${notice.claimId}`,
    employeeName: notice.employeeName,
    departmentName: notice.departmentName,
    extra: { reason: notice.reason },
    dryRun: false
  });
}

export interface LeaveDecisionNotice {
  claimId: string;
  employee: NotifyTarget;
  reportDate: string;
  decision: 'APPROVED' | 'REJECTED';
  decisionReason: string;
  rejectionOutcome: 'reinstated' | 'waived' | null;
  deadlineAt: Date;
}

export async function notifyLeaveDecision(notice: LeaveDecisionNotice): Promise<void> {
  await deliver({
    kind: 'leave_decision',
    recipients: [notice.employee],
    title: `Leave claim ${notice.decision === 'APPROVED' ? 'approved' : 'rejected'} — ${notice.reportDate}`,
    body:
      notice.decision === 'APPROVED'
        ? `Your leave claim for ${notice.reportDate} was approved. Any warning for that date has been waived.`
        : notice.rejectionOutcome === 'waived'
          ? `Your leave claim for ${notice.reportDate} was rejected, but the reporting obligation for that date has been waived.`
          : `Your leave claim for ${notice.reportDate} was rejected. Please file the report for that date.`,
    entityType: 'daily_report_leave_claim',
    entityId: notice.claimId,
    type: 'daily_report_leave_decision',
    reportDate: notice.reportDate,
    deadlineLabel: formatIst(notice.deadlineAt),
    actionPath: `/daily-reports?date=${notice.reportDate}`,
    employeeName: notice.employee.name,
    extra: { decision: notice.decision, decisionReason: notice.decisionReason, rejectionOutcome: notice.rejectionOutcome },
    dryRun: false
  });
}

export interface EditRequestNotice {
  requestId: string;
  employeeName: string;
  departmentName: string;
  reportDate: string;
  reason: string;
  managers: NotifyTarget[];
}

/**
 * Somebody wants to change a report they have already filed.
 *
 * Deliberately NOT claimed in the notification ledger. An employee may
 * legitimately ask a second time after a refusal, and a ledger claim keyed on
 * (employee, date, event) would silence every later request permanently.
 */
export async function notifyEditRequestRaised(notice: EditRequestNotice): Promise<void> {
  if (!notice.managers.length) {
    // Loud, for the same reason the leave claim is: a request nobody can see
    // sits PENDING forever, and the employee cannot correct their report.
    console.error(
      `[daily-report] Edit request ${notice.requestId} for ${notice.reportDate} was raised but no manager is configured for ${notice.departmentName || 'that department'} in Department Master — nobody has been notified.`
    );
    return;
  }
  await deliver({
    kind: 'edit_request',
    recipients: notice.managers,
    title: `Edit requested — ${notice.employeeName}, ${notice.reportDate}`,
    body: `${notice.employeeName} is asking to change the daily report they filed for ${notice.reportDate}.`,
    entityType: 'daily_report_edit_request',
    entityId: notice.requestId,
    type: 'daily_report_edit_request',
    reportDate: notice.reportDate,
    deadlineLabel: '',
    actionPath: `/daily-reports?tab=team&date=${notice.reportDate}&editRequest=${notice.requestId}`,
    employeeName: notice.employeeName,
    departmentName: notice.departmentName,
    extra: { reason: notice.reason },
    dryRun: false
  });
}

export interface EditDecisionNotice {
  requestId: string;
  employee: NotifyTarget;
  employeeName: string;
  departmentName: string;
  reportDate: string;
  decision: 'APPROVED' | 'REJECTED';
  decisionReason: string;
  grantExpiresAt: string;
}

export async function notifyEditRequestDecision(notice: EditDecisionNotice): Promise<void> {
  await deliver({
    kind: 'edit_decision',
    recipients: [notice.employee],
    title: `Edit ${notice.decision === 'APPROVED' ? 'allowed' : 'refused'} — ${notice.reportDate}`,
    body:
      notice.decision === 'APPROVED'
        ? `You can now change your daily report for ${notice.reportDate}. The permission is good for one save.`
        : `Your request to change the daily report for ${notice.reportDate} was refused.`,
    entityType: 'daily_report_edit_request',
    entityId: notice.requestId,
    type: 'daily_report_edit_decision',
    reportDate: notice.reportDate,
    deadlineLabel: '',
    actionPath: `/daily-reports?date=${notice.reportDate}`,
    employeeName: notice.employeeName,
    departmentName: notice.departmentName,
    extra: { decision: notice.decision, decisionReason: notice.decisionReason },
    dryRun: false
  });
}
