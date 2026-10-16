import { getDailyReportConfig, getDeadlinePolicy } from './dailyReportConfigStore';
import { EligibleEmployee, employeeOwesDate, expandSubjects, listEligibleEmployees } from './dailyReportEligibility';
import { autoSubmitReport, loadAutoTotalsByKey, loadSubmittedKeys } from './dailyReportStore';
import { loadLeaveCoveredKeys } from './dailyReportLeaveClaimStore';
import {
  claimEscalation,
  loadActiveCountsByMonth,
  loadEscalatedKeys,
  loadWarningKeys,
  markEscalationNotified,
  recordWarning
} from './dailyReportWarningStore';
import {
  PlannedAutoSubmit,
  PlannedEvent,
  PlannedZeroTotalWarning,
  escalationKey,
  eventKey,
  planAutoSubmits,
  planEscalations,
  planSweep,
  planZeroTotalWarnings,
  subjectKey,
  sweepWindow
} from './dailyReportSweepPlan';
import { claimNotificationEvent, clearFailedClaim, deliver, loadSentEventKeys, NotifyTarget, recordEventOutcome } from './dailyReportNotify';
import { resolveHrRecipients } from './dailyReportAccess';
import { addDays, formatIst, istDate, monthKey, previousWorkingDay, scheduleFor } from './dailyReportTime';
import { BUILT_IN_TEMPLATES } from './dailyReportTemplates';
import { db } from './db';

/**
 * How far back auto-submit catches up, independent of reconcile_window_days
 * (which still governs reminders/warnings). See its use in
 * runDailyReportSweep for why this is deliberately short.
 */
const AUTO_SUBMIT_LOOKBACK_DAYS = 2;

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

    // Sales/GEM-Sales today — anyone on a template with auto-fetched
    // measures (lib/dailyReportTemplates.ts's autoMeasures). Named off the
    // template shape, not a department name, so a future department given
    // the same template is covered with no change here.
    const salesEmployees = employees.filter((e) => BUILT_IN_TEMPLATES[e.templateKey]?.autoMeasures?.length);

    // Used only to plan the auto-submit pass below — reloaded fresh,
    // together with `submitted`, immediately before planSweep further down.
    // Reusing this same snapshot for planSweep was a real bug: the
    // auto-submit pass between the two can run long during backlog catch-up,
    // and a leave claim filed or approved in that window must still count.
    const leaveCoveredEarly = await loadLeaveCoveredKeys(employeeIds, from, to);

    // Auto-submit runs BEFORE the reminder/warning plan is built below, and
    // against its own freshly-loaded `submitted` set, so that a report this
    // very pass just auto-filed already reads as submitted by the time the
    // warning step decides who missed the deadline — the same
    // "recheck immediately before acting" rule the warning step already
    // follows for a late-arriving human submission or leave claim. Without
    // this ordering, a cron interval wide enough to span both the 10:30
    // auto-submit time and the (later) global deadline in one sweep would
    // warn someone the same pass that just auto-submitted for them.
    if (salesEmployees.length) {
      const salesIdSet = new Set(salesEmployees.map((e) => e.id));
      // Capped to a short, separate lookback rather than the full
      // reconcile_window_days: auto-submit's own premise is "by tomorrow
      // morning", not "resurrect a week of backlog" — and this schema has
      // no department-assignment HISTORY anywhere (a transfer just
      // overwrites users.departmentId), so a catch-up for an OLD date
      // always files it under whoever's CURRENT department, which is wrong
      // for a date that predates a transfer. A short lookback keeps that
      // pre-existing, schema-level gap to "the scheduler was briefly down"
      // rather than "any transfer in the last week". The ordinary
      // missed-report warning (unaffected by this cap) still covers every
      // date in the full window regardless.
      const autoSubmitFloor = addDays(istDate(now), -AUTO_SUBMIT_LOOKBACK_DAYS);
      const salesSubjects = subjects.filter((s) => salesIdSet.has(s.employeeId) && s.reportDate >= autoSubmitFloor);
      const salesSubmitted = await loadSubmittedKeys([...salesIdSet], from, to);
      const plannedAutoSubmits = planAutoSubmits(salesSubjects, { submitted: salesSubmitted, leaveCovered: leaveCoveredEarly }, now, config.sales_auto_submit_time, policy);

      for (const event of plannedAutoSubmits) {
        bump(stats.planned, 'AUTO_SUBMIT');
        if (event.late) stats.catchUp += 1;
      }
      for (const event of plannedAutoSubmits) {
        const employee = employeeById.get(event.employeeId);
        if (!employee) continue;
        try {
          const handled = await processAutoSubmit(event, employee, dryRun);
          if (handled) bump(stats.sent, 'AUTO_SUBMIT');
          else stats.skipped += 1;
        } catch (error) {
          stats.failures.push({
            employeeId: event.employeeId,
            reportDate: event.reportDate,
            kind: 'AUTO_SUBMIT',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    // All three state sets are loaded in one pass each, immediately before
    // planning — this is the "recheck submission and leave status before
    // recording a warning" requirement, and it is also why planning is a
    // pure function over sets rather than a loop of queries. `submitted` AND
    // `leaveCovered` are both read fresh here (not reused from above) so the
    // plan reflects any auto-submit this pass just performed, and any leave
    // claim filed or approved while that pass was running.
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

    // The 2-zero-day streak check runs BEFORE processEscalations, not after
    // — processEscalations's own doc comment is explicit that it must run
    // "after every warning for the run has landed" so a threshold-crossing
    // warning recorded earlier in the SAME run escalates immediately rather
    // than waiting a full sweep cycle. It also reads whatever just landed as
    // submitted from the auto-submit pass above — a day the system just
    // auto-filed with a genuinely empty grid is exactly the kind of day this
    // is watching for, not an exception to it.
    if (salesEmployees.length) {
      const salesIds = salesEmployees.map((e) => e.id);
      // One extra working day prepended so the EARLIEST date in the window
      // still has a predecessor to compare against — otherwise a streak that
      // started before the window could never be detected the day the
      // window first includes it.
      const extendedFrom = previousWorkingDay(from, policy);
      const [autoTotalByKey, alreadyWarned] = await Promise.all([
        loadAutoTotalsByKey(salesIds, extendedFrom, to),
        // Scoped to zero_total only: a date can already carry a 'scheduler'
        // (missed entirely) warning from before it was later auto-submitted
        // — that date's one (employee, date) slot is occupied by an
        // unrelated warning, and must not be read as "already warned about
        // zero activity", which would silently suppress the dedicated
        // zero-total warning and email for it.
        loadWarningKeys(salesIds, extendedFrom, to, ['zero_total'])
      ]);
      const extendedDates = [extendedFrom, ...reportDates];
      const datesByEmployee = new Map(salesEmployees.map((e) => [e.id, extendedDates.filter((d) => employeeOwesDate(e, d))]));
      const plannedZero = planZeroTotalWarnings(datesByEmployee, autoTotalByKey, alreadyWarned);

      for (const zero of plannedZero) {
        const employee = employeeById.get(zero.employeeId);
        if (!employee) continue;
        try {
          const handled = await processZeroTotalWarning(zero, employee, dryRun, stats);
          if (handled) bump(stats.sent, 'ZERO_TOTAL_WARNING');
          else stats.skipped += 1;
        } catch (error) {
          stats.failures.push({
            employeeId: zero.employeeId,
            reportDate: zero.reportDate,
            kind: 'ZERO_TOTAL_WARNING',
            error: error instanceof Error ? error.message : String(error)
          });
        }
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
 * Files a Sales/GEM-Sales report on an employee's behalf once the
 * configured auto-submit time has passed with nothing submitted — the
 * employee's own tracked activity (lib/salesDailyAutoFetch.ts) stands in for
 * whatever they did not type themselves.
 */
async function processAutoSubmit(event: PlannedAutoSubmit, employee: EligibleEmployee, dryRun: boolean): Promise<boolean> {
  // See clearFailedClaim's own comment: this is the one and only path that
  // actually auto-files the report, so a dead 'failed' claim from an
  // earlier interrupted attempt must not permanently block every future
  // retry the way it is acceptable to for a plain notification.
  await clearFailedClaim(event.employeeId, event.reportDate, 'AUTO_SUBMIT');
  const claim = await claimNotificationEvent(event.employeeId, event.reportDate, 'AUTO_SUBMIT', event.dueAt, dryRun);
  if (!claim) return false;

  if (dryRun) {
    await recordEventOutcome(claim.id, 'dry_run', { autoSubmit: 'would submit' });
    console.info(`[daily-report][dry-run] would auto-submit ${employee.username}'s ${event.reportDate} report`);
    return true;
  }

  try {
    const result = await autoSubmitReport(event.employeeId, employee.departmentId, event.reportDate);

    // A race with the employee's own submit lands here as an ordinary edit,
    // not a fresh submission (see saveReport's wasSubmitted branch) —
    // justSubmitted is false, and telling them "this was auto-submitted"
    // would be simply wrong, so nothing is sent and the ledger row records
    // why.
    if (!result.justSubmitted) {
      await recordEventOutcome(claim.id, 'skipped', { reason: 'employee submitted before the auto-submit ran' });
      return true;
    }

    const delivery = await deliver({
      kind: 'auto_submitted',
      recipients: [targetFor(employee)],
      title: `Daily report auto-submitted — ${event.reportDate}`,
      body: `Your ${event.reportDate} daily report was not submitted, so it has been filed automatically from your tracked activity.`,
      entityType: 'daily_report',
      entityId: result.report.id,
      type: 'daily_report_auto_submitted',
      reportDate: event.reportDate,
      deadlineLabel: formatIst(event.dueAt),
      actionPath: `/daily-reports?date=${event.reportDate}`,
      departmentName: employee.departmentName,
      dryRun
    });

    await recordEventOutcome(
      claim.id,
      delivery.inApp || delivery.email ? 'sent' : 'failed',
      { inApp: delivery.inApp, email: delivery.email, reportId: result.report.id, failures: delivery.emailFailures },
      delivery.emailFailures.length ? `Email not delivered to: ${delivery.emailFailures.join(', ')}` : undefined
    );
  } catch (error) {
    await recordEventOutcome(claim.id, 'failed', {}, error instanceof Error ? error.message : String(error));
    throw error;
  }
  return true;
}

/**
 * Records (and notifies on) the second or later consecutive reporting day a
 * Sales/GEM-Sales employee's auto-fetched total came to zero.
 *
 * Deliberately the SAME warning ledger and HR escalation pipeline as a
 * missed report, just a different `source` tag: both are "something about
 * this person's reporting needs a human look", and splitting them into two
 * separately-counted systems would need HR to watch two places instead of
 * one. A date warned here was, by construction, actually submitted, so it
 * can never collide with a missed-report warning on the same date.
 */
async function processZeroTotalWarning(planned: PlannedZeroTotalWarning, employee: EligibleEmployee, dryRun: boolean, stats: SweepStats): Promise<boolean> {
  // See clearFailedClaim's own comment: this is the one and only path that
  // actually records the streak warning, so a dead 'failed' claim must not
  // permanently block every future retry.
  await clearFailedClaim(planned.employeeId, planned.reportDate, 'ZERO_TOTAL_WARNING');
  const claim = await claimNotificationEvent(planned.employeeId, planned.reportDate, 'ZERO_TOTAL_WARNING', null, dryRun);
  if (!claim) return false;

  if (dryRun) {
    await recordEventOutcome(claim.id, 'dry_run', { zeroTotalWarning: 'would record' });
    console.info(`[daily-report][dry-run] would record a zero-activity warning for ${employee.username} on ${planned.reportDate}`);
    return true;
  }

  try {
    const warning = await recordWarning({
      employeeId: planned.employeeId,
      departmentId: employee.departmentId,
      reportDate: planned.reportDate,
      source: 'zero_total'
    });
    if (warning) stats.warningsRecorded += 1;

    const counts = await loadActiveCountsByMonth([planned.employeeId], [monthKey(planned.reportDate)]);
    const activeCount = counts.get(escalationKey(planned.employeeId, monthKey(planned.reportDate))) ?? 0;

    const result = await deliver({
      kind: 'zero_total_warning',
      recipients: [targetFor(employee)],
      title: `No sales activity recorded — ${planned.reportDate}`,
      body: `Your auto-tracked sales activity has been zero for two reporting days in a row, through ${planned.reportDate}. You have ${activeCount} active warning${activeCount === 1 ? '' : 's'} this month.`,
      // Same reasoning as processWarning's own fallback: a null `warning`
      // means the row already existed, so the notification still resolves
      // somewhere sensible via the claimed ledger row instead.
      ...(warning ? { entityType: 'daily_report_warning' as const, entityId: warning.id } : { entityType: 'daily_report_reminder' as const, entityId: claim.id }),
      type: 'daily_report_zero_total_warning',
      reportDate: planned.reportDate,
      deadlineLabel: '',
      actionPath: `/daily-reports?date=${planned.reportDate}`,
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
  } catch (error) {
    // Unlike processWarning (same gap, pre-existing, out of scope here),
    // this path is caught: recordWarning may already have committed a real,
    // escalation-counted row before a later step throws, and without this
    // the claimed ledger slot would be stuck at its optimistic 'sent'
    // status forever with no notification ever having gone out.
    await recordEventOutcome(claim.id, 'failed', {}, error instanceof Error ? error.message : String(error));
    throw error;
  }
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
  autoSubmitDue: number;
  zeroTotalWarningsDue: number;
}> {
  const config = await getDailyReportConfig();
  const policy = await getDeadlinePolicy();
  const reportDates = sweepWindow(now, config.reconcile_window_days, policy);
  const employees = await listEligibleEmployees();
  if (!reportDates.length || !employees.length) {
    return { reportDates, dueNow: [], eligibleEmployees: employees.length, byKind: {}, autoSubmitDue: 0, zeroTotalWarningsDue: 0 };
  }
  const employeeIds = employees.map((e) => e.id);
  const from = reportDates[0];
  const to = reportDates[reportDates.length - 1];
  const subjects = expandSubjects(employees, reportDates);
  const [submitted, leaveCovered, sent] = await Promise.all([
    loadSubmittedKeys(employeeIds, from, to),
    loadLeaveCoveredKeys(employeeIds, from, to),
    loadSentEventKeys(employeeIds, from, to)
  ]);
  const dueNow = planSweep(subjects, { submitted, leaveCovered, sent }, now, policy);
  const byKind: Record<string, number> = {};
  for (const event of dueNow) bump(byKind, event.kind);

  // Read-only mirror of the live auto-submit / zero-total passes inside
  // runDailyReportSweep, so the admin's rehearsal reflects everything the
  // sweep actually does, not just the three original reminder/warning kinds.
  let autoSubmitDue = 0;
  let zeroTotalWarningsDue = 0;
  const salesEmployees = employees.filter((e) => BUILT_IN_TEMPLATES[e.templateKey]?.autoMeasures?.length);
  if (salesEmployees.length) {
    const salesIdSet = new Set(salesEmployees.map((e) => e.id));
    const salesIds = [...salesIdSet];
    // Same short lookback as the live sweep — see runDailyReportSweep's own
    // comment — so this preview doesn't overstate what auto-submit will
    // actually do.
    const autoSubmitFloor = addDays(istDate(now), -AUTO_SUBMIT_LOOKBACK_DAYS);
    const salesSubjects = subjects.filter((s) => salesIdSet.has(s.employeeId) && s.reportDate >= autoSubmitFloor);

    autoSubmitDue = planAutoSubmits(salesSubjects, { submitted, leaveCovered }, now, config.sales_auto_submit_time, policy).length;
    if (autoSubmitDue) byKind.AUTO_SUBMIT = autoSubmitDue;

    const extendedFrom = previousWorkingDay(from, policy);
    const [autoTotalByKey, alreadyWarned] = await Promise.all([
      loadAutoTotalsByKey(salesIds, extendedFrom, to),
      loadWarningKeys(salesIds, extendedFrom, to, ['zero_total'])
    ]);
    const extendedDates = [extendedFrom, ...reportDates];
    const datesByEmployee = new Map(salesEmployees.map((e) => [e.id, extendedDates.filter((d) => employeeOwesDate(e, d))]));
    zeroTotalWarningsDue = planZeroTotalWarnings(datesByEmployee, autoTotalByKey, alreadyWarned).length;
    if (zeroTotalWarningsDue) byKind.ZERO_TOTAL_WARNING = zeroTotalWarningsDue;
  }

  return { reportDates, dueNow, eligibleEmployees: employees.length, byKind, autoSubmitDue, zeroTotalWarningsDue };
}

/** Re-exported for the route's own logging. */
export { subjectKey, eventKey };
