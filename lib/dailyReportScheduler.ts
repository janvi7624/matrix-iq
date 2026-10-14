import { getDailyReportConfig, getDeadlinePolicy } from './dailyReportConfigStore';
import { EligibleEmployee, expandSubjects, listEligibleEmployees } from './dailyReportEligibility';
import { loadSubmittedKeys } from './dailyReportStore';
import { loadLeaveCoveredKeys } from './dailyReportLeaveClaimStore';
import {
  claimEscalation,
  loadActiveCountsByMonth,
  loadEscalatedKeys,
  markEscalationNotified,
  recordWarning
} from './dailyReportWarningStore';
import {
  PlannedEvent,
  escalationKey,
  eventKey,
  planEscalations,
  planSweep,
  subjectKey,
  sweepWindow
} from './dailyReportSweepPlan';
import { claimNotificationEvent, deliver, loadSentEventKeys, NotifyTarget, recordEventOutcome } from './dailyReportNotify';
import { resolveHrRecipients } from './dailyReportAccess';
import { formatIst, monthKey, scheduleFor } from './dailyReportTime';
import { db } from './db';

// The sweep: the one server-side job behind every reminder, warning and HR
// escalation.
//
// Shape, and why it is this shape:
//
//   This app has no in-process scheduler and no cron infrastructure of its
//   own — the closest existing precedent is the manually-triggered
//   /api/admin/project-detail-reminders sweep. Rather than introduce a
//   long-lived timer inside a Next.js process (which would fire N times on N
//   instances and die on every redeploy), this is an idempotent HTTP
//   endpoint that an external scheduler calls on a fixed cadence, and the
//   endpoint works out what is due. That inverts the reliability problem in
//   a useful way: the job no longer has to run at exactly 21:00, it only has
//   to run SOMETIME after 21:00.
//
//   Everything below follows from that. The sweep considers a WINDOW of
//   recent working days rather than only today, so a run that was missed —
//   host down, deploy in progress, cron misconfigured — is reconciled
//   automatically the next time it runs. Every side effect is guarded by a
//   unique database row, so running it twice a minute apart does nothing the
//   second time. And submission and leave status are re-read immediately
//   before the warning step, so a report filed at 10:59 or a claim raised at
//   10:58 counts.
//
// The decision of WHAT is due lives in lib/dailyReportSweepPlan.ts as a pure
// function; this file loads state, calls it, and performs the effects.

export interface SweepOptions {
  /** 'cron' | 'manual' — a manual run from the admin page is distinguishable. */
  trigger?: 'cron' | 'manual';
  /**
   * Overrides the configured dry-run flag for ONE run. The admin page uses
   * this to rehearse on demand without changing the stored policy; it can
   * only ever be used to force dry-run ON, never to force a live send past a
   * configuration that says dry-run.
   */
  forceDryRun?: boolean;
  /** Injected in tests; defaults to now. */
  now?: Date;
}

export interface SweepStats {
  window: { from: string; to: string; reportDates: string[] };
  eligibleEmployees: number;
  subjects: number;
  planned: Record<string, number>;
  sent: Record<string, number>;
  skipped: number;
  warningsRecorded: number;
  escalationsSent: number;
  catchUp: number;
  failures: { employeeId: string; reportDate: string; kind: string; error: string }[];
  dryRun: boolean;
}

export interface SweepResult {
  runId: string;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  reason?: string;
  stats: SweepStats;
}

function emptyStats(dryRun: boolean): SweepStats {
  return {
    window: { from: '', to: '', reportDates: [] },
    eligibleEmployees: 0,
    subjects: 0,
    planned: {},
    sent: {},
    skipped: 0,
    warningsRecorded: 0,
    escalationsSent: 0,
    catchUp: 0,
    failures: [],
    dryRun
  };
}

function bump(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function targetFor(employee: EligibleEmployee): NotifyTarget {
  return { username: employee.username, name: employee.name, email: employee.email };
}

/**
 * Runs one sweep.
 *
 * Never throws: a sweep is called unattended by a cron process that has
 * nowhere to report an exception, so every failure is recorded on the run
 * row and in the returned stats instead. The HTTP route turns that into a
 * response an administrator (or an uptime monitor) can read.
 */
export async function runDailyReportSweep(options: SweepOptions = {}): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const trigger = options.trigger ?? 'cron';
  const config = await getDailyReportConfig();
  const dryRun = config.dry_run || !!options.forceDryRun;

  const run = await db.DailyReportSchedulerRun.create({
    job_key: 'daily_report_sweep',
    started_at: now,
    status: 'running',
    dry_run: dryRun,
    trigger,
    stats: {}
  } as never);
  const runId = run.get('id') as string;

  const finish = async (status: SweepResult['status'], stats: SweepStats, reason?: string): Promise<SweepResult> => {
    await run.update({ status, finished_at: new Date(), stats: stats as never, error: reason ?? null } as never);
    return { runId, status, reason, stats };
  };

  // The master switch. Checked here rather than in the route so that a
  // manual run from the admin page obeys it too — "the scheduler is off"
  // must mean nobody gets mailed, by any path.
  if (!config.scheduler_enabled) {
    const stats = emptyStats(dryRun);
    return finish('skipped', stats, 'The Daily Report scheduler is disabled in Daily Report Configuration.');
  }

  const stats = emptyStats(dryRun);

  try {
    const policy = await getDeadlinePolicy();
    const reportDates = sweepWindow(now, config.reconcile_window_days, policy);
    if (!reportDates.length) {
      return finish('ok', { ...stats, window: { from: '', to: '', reportDates: [] } }, 'No working days in the reconcile window.');
    }
    const from = reportDates[0];
    const to = reportDates[reportDates.length - 1];
    stats.window = { from, to, reportDates };

    // Only departments with a CONFIGURED template, and only active
    // employees — Accounts and any unassigned department are excluded here,
    // at the source, so no later step can accidentally include them.
    const employees = await listEligibleEmployees();
    stats.eligibleEmployees = employees.length;
    if (!employees.length) return finish('ok', stats, 'No eligible employees — every department is still unconfigured.');

    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const employeeIds = employees.map((e) => e.id);
    const subjects = expandSubjects(employees, reportDates);
    stats.subjects = subjects.length;

    // All three state sets are loaded in one pass each, immediately before
    // planning — this is the "recheck submission and leave status before
    // recording a warning" requirement, and it is also why planning is a
    // pure function over sets rather than a loop of queries.
    const [submitted, leaveCovered, sent] = await Promise.all([
      loadSubmittedKeys(employeeIds, from, to),
      loadLeaveCoveredKeys(employeeIds, from, to),
      loadSentEventKeys(employeeIds, from, to)
    ]);

    const planned = planSweep(subjects, { submitted, leaveCovered, sent }, now, policy);
    for (const event of planned) {
      bump(stats.planned, event.kind);
      if (event.late) stats.catchUp += 1;
    }

    for (const event of planned) {
      const employee = employeeById.get(event.employeeId);
      if (!employee) continue;
      try {
        const handled = event.kind === 'WARNING' ? await processWarning(event, employee, policy, dryRun, stats) : await processReminder(event, employee, policy, dryRun);
        if (handled) bump(stats.sent, event.kind);
        else stats.skipped += 1;
      } catch (error) {
        // One person's failed notification must not stop the rest of the
        // sweep — the remaining subjects are other people's compliance
        // records.
        stats.failures.push({
          employeeId: event.employeeId,
          reportDate: event.reportDate,
          kind: event.kind,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    await processEscalations(employees, reportDates, config.warning_threshold, dryRun, stats);

    return finish(stats.failures.length ? 'partial' : 'ok', stats);
  } catch (error) {
    return finish('failed', stats, error instanceof Error ? error.message : String(error));
  }
}

async function processReminder(
  event: PlannedEvent,
  employee: EligibleEmployee,
  policy: Awaited<ReturnType<typeof getDeadlinePolicy>>,
  dryRun: boolean
): Promise<boolean> {
  const claim = await claimNotificationEvent(event.employeeId, event.reportDate, event.kind, event.dueAt, dryRun);
  // Null means another sweep got there first — not an error, and the
  // mechanism that makes retries free.
  if (!claim) return false;

  const schedule = scheduleFor(event.reportDate, policy);
  const result = await deliver({
    kind: event.kind === 'REMINDER_FINAL' ? 'reminder_final' : 'reminder_evening',
    recipients: [targetFor(employee)],
    title: event.kind === 'REMINDER_FINAL' ? `Daily report due in one hour — ${event.reportDate}` : `Daily report pending — ${event.reportDate}`,
    body:
      event.kind === 'REMINDER_FINAL'
        ? `Your ${event.reportDate} daily report is due at ${formatIst(schedule.deadlineAt)} — one hour from now.`
        : `Your ${event.reportDate} daily report has not been submitted yet. It is due by ${formatIst(schedule.deadlineAt)}.`,
    // 'daily_report_reminder', not 'daily_report': the ledger row's id is
    // what exists at this moment — the report itself does not, which is the
    // entire subject of the mail — and notificationResolver checks that the
    // referenced row is really there before showing the bell entry.
    entityType: 'daily_report_reminder',
    entityId: claim.id,
    type: event.kind === 'REMINDER_FINAL' ? 'daily_report_reminder_final' : 'daily_report_reminder',
    reportDate: event.reportDate,
    deadlineLabel: formatIst(schedule.deadlineAt),
    actionPath: `/daily-reports?date=${event.reportDate}`,
    departmentName: employee.departmentName,
    dryRun
  });

  await recordEventOutcome(
    claim.id,
    dryRun ? 'dry_run' : result.inApp || result.email ? 'sent' : 'failed',
    { inApp: result.inApp, email: result.email, failures: result.emailFailures },
    result.emailFailures.length ? `Email not delivered to: ${result.emailFailures.join(', ')}` : undefined
  );
  return true;
}

async function processWarning(
  event: PlannedEvent,
  employee: EligibleEmployee,
  policy: Awaited<ReturnType<typeof getDeadlinePolicy>>,
  dryRun: boolean,
  stats: SweepStats
): Promise<boolean> {
  const claim = await claimNotificationEvent(event.employeeId, event.reportDate, 'WARNING', event.dueAt, dryRun);
  if (!claim) return false;

  const schedule = scheduleFor(event.reportDate, policy);

  if (dryRun) {
    await recordEventOutcome(claim.id, 'dry_run', { warning: 'would record' });
    console.info(`[daily-report][dry-run] would record a missed-report warning for ${employee.username} on ${event.reportDate}`);
    return true;
  }

  // The warning row itself is also unique on (employee, date), so even if
  // the ledger were bypassed this cannot double-record. recordWarning
  // returns null in that case, which is success, not failure.
  const warning = await recordWarning({
    employeeId: event.employeeId,
    departmentId: employee.departmentId,
    reportDate: event.reportDate
  });
  if (warning) stats.warningsRecorded += 1;

  const counts = await loadActiveCountsByMonth([event.employeeId], [monthKey(event.reportDate)]);
  const activeCount = counts.get(escalationKey(event.employeeId, monthKey(event.reportDate))) ?? 0;

  const result = await deliver({
    kind: 'warning',
    recipients: [targetFor(employee)],
    title: `Missed daily report — ${event.reportDate}`,
    body: `A missed-report warning was recorded for ${event.reportDate}. You have ${activeCount} active warning${activeCount === 1 ? '' : 's'} this month.`,
    // A null `warning` means the row already existed (the unique index did
    // its job on a concurrent sweep), so fall back to the ledger row, which
    // resolves to the same page under its own entity type.
    ...(warning ? { entityType: 'daily_report_warning' as const, entityId: warning.id } : { entityType: 'daily_report_reminder' as const, entityId: claim.id }),
    type: 'daily_report_warning',
    reportDate: event.reportDate,
    deadlineLabel: formatIst(schedule.deadlineAt),
    actionPath: `/daily-reports?date=${event.reportDate}`,
    departmentName: employee.departmentName,
    extra: { activeWarnings: activeCount },
    dryRun
  });

  await recordEventOutcome(
    claim.id,
    result.inApp || result.email ? 'sent' : 'failed',
    { inApp: result.inApp, email: result.email, warningId: warning?.id ?? null, failures: result.emailFailures },
    result.emailFailures.length ? `Email not delivered to: ${result.emailFailures.join(', ')}` : undefined
  );
  return true;
}

/**
 * The HR escalation pass, run once at the end rather than inside the warning
 * loop.
 *
 * Doing it after every warning for the run has landed means the count it
 * compares against the threshold is the FINAL count for the month, so a
 * catch-up run that records a person's second and third missed day in the
 * same pass sends one escalation rather than evaluating the threshold
 * half-way through.
 */
async function processEscalations(
  employees: EligibleEmployee[],
  reportDates: string[],
  threshold: number,
  dryRun: boolean,
  stats: SweepStats
): Promise<void> {
  const employeeIds = employees.map((e) => e.id);
  const monthKeys = Array.from(new Set(reportDates.map(monthKey)));
  const [activeCounts, alreadyEscalated] = await Promise.all([
    loadActiveCountsByMonth(employeeIds, monthKeys),
    loadEscalatedKeys(employeeIds, monthKeys)
  ]);

  const planned = planEscalations(activeCounts, alreadyEscalated, threshold);
  if (!planned.length) return;

  const [hrRecipients, employeeById] = [await resolveHrRecipients(), new Map(employees.map((e) => [e.id, e]))];

  for (const escalation of planned) {
    const employee = employeeById.get(escalation.employeeId);
    if (!employee) continue;

    if (dryRun) {
      console.info(
        `[daily-report][dry-run] would escalate ${employee.username} to HR — ${escalation.activeWarnings} active warnings in ${escalation.monthKey}`
      );
      stats.escalationsSent += 1;
      continue;
    }

    // Collect the dates for the email body before claiming, so the claimed
    // row records what it was about.
    const missed = await db.DailyReportWarning.findAll({
      where: { employee_id: escalation.employeeId, month_key: escalation.monthKey, status: 'ACTIVE' } as never,
      attributes: ['report_date'],
      order: [['report_date', 'ASC']]
    });
    const missedDates = missed.map((r) => {
      const value = r.get('report_date');
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    });

    // Claims the single monthly slot. Null = another run already has it.
    const claimed = await claimEscalation(escalation.employeeId, escalation.monthKey, escalation.activeWarnings, missedDates);
    if (!claimed) continue;

    if (!hrRecipients.length) {
      // Recorded as failed rather than silently dropped: an org with no HR
      // manager mapped in Department Master would otherwise never learn that
      // its escalations are going nowhere.
      await markEscalationNotified(claimed.id, [], 'failed', 'No HR manager is configured in Department Master — nobody could be notified.');
      stats.failures.push({
        employeeId: escalation.employeeId,
        reportDate: escalation.monthKey,
        kind: 'HR_ESCALATION',
        error: 'No HR manager configured in Department Master'
      });
      continue;
    }

    const result = await deliver({
      kind: 'hr_escalation',
      recipients: hrRecipients.map((m) => ({ username: m.username, name: m.name, email: m.email })),
      title: `Daily report escalation — ${employee.name}`,
      body: `${employee.name} has ${escalation.activeWarnings} active missed-report warnings in ${escalation.monthKey}.`,
      entityType: 'daily_report_escalation',
      entityId: claimed.id,
      type: 'daily_report_escalation',
      reportDate: missedDates[missedDates.length - 1] ?? escalation.monthKey,
      deadlineLabel: '',
      actionPath: `/hr/daily-reports?tab=warnings&employee=${escalation.employeeId}&month=${escalation.monthKey}`,
      employeeName: employee.name,
      departmentName: employee.departmentName,
      extra: { activeWarnings: escalation.activeWarnings, threshold, missedDates },
      dryRun
    });

    await markEscalationNotified(
      claimed.id,
      hrRecipients.map((m) => m.username),
      result.inApp || result.email ? 'sent' : 'failed',
      result.emailFailures.length ? `Email not delivered to: ${result.emailFailures.join(', ')}` : undefined
    );
    stats.escalationsSent += 1;
  }
}

/**
 * What the sweep WOULD do, without claiming anything or sending anything.
 *
 * Distinct from the dry_run config flag: that one still writes ledger rows
 * (so a rehearsal is a faithful rehearsal of idempotency too, and a
 * rehearsed date is not re-sent later). This is a read-only preview for the
 * admin page, safe to refresh as often as you like.
 */
export async function previewDailyReportSweep(now = new Date()): Promise<{
  reportDates: string[];
  dueNow: PlannedEvent[];
  eligibleEmployees: number;
  byKind: Record<string, number>;
}> {
  const config = await getDailyReportConfig();
  const policy = await getDeadlinePolicy();
  const reportDates = sweepWindow(now, config.reconcile_window_days, policy);
  const employees = await listEligibleEmployees();
  if (!reportDates.length || !employees.length) {
    return { reportDates, dueNow: [], eligibleEmployees: employees.length, byKind: {} };
  }
  const employeeIds = employees.map((e) => e.id);
  const from = reportDates[0];
  const to = reportDates[reportDates.length - 1];
  const [submitted, leaveCovered, sent] = await Promise.all([
    loadSubmittedKeys(employeeIds, from, to),
    loadLeaveCoveredKeys(employeeIds, from, to),
    loadSentEventKeys(employeeIds, from, to)
  ]);
  const dueNow = planSweep(expandSubjects(employees, reportDates), { submitted, leaveCovered, sent }, now, policy);
  const byKind: Record<string, number> = {};
  for (const event of dueNow) bump(byKind, event.kind);
  return { reportDates, dueNow, eligibleEmployees: employees.length, byKind };
}

/** Re-exported for the route's own logging. */
export { subjectKey, eventKey };
