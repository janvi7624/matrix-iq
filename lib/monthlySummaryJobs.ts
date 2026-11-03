// Running the two monthly-summary jobs from inside the app.
//
// Both were built as HTTP endpoints for an external cron to POST — this
// app's documented "no in-process scheduler" pattern. The endpoints are
// correct and their migrations are applied, but nothing ever called them:
// monthly_summary_runs and back_office_monthly_summary_runs both held ZERO
// rows, so no monthly review had ever been sent to a department manager, to
// Mayank Jani, or to Back Office.
//
// Meanwhile the daily-report SWEEP does run — 157 runs and counting —
// because it schedules itself in process (lib/dailyReportAutoSweep.ts). The
// two mechanisms were inconsistent, and the one that depended on
// infrastructure nobody had set up is the one that silently did nothing.
//
// So these jobs now run from that same self-scheduling tick. That is safe
// precisely because they were written for a daily cadence: each claims
// (job_key, scope_key, month_key) before sending, so the first call in a
// month sends and every later call that month is a no-op. Calling them four
// times a day costs two indexed lookups per sweep and removes the
// dependency on a crontab existing.
//
// The HTTP endpoints stay, delegating here, so an external cron still works
// for anyone who has one.

import { runBackOfficeMonthlySummary } from './backOfficeMonthlySummaryJob';
import { runDailyReportMonthlySummary } from './dailyReportMonthlySummaryJob';

export interface MonthlySummaryOutcome {
  dailyReport: Awaited<ReturnType<typeof runDailyReportMonthlySummary>> | { error: string };
  backOffice: Awaited<ReturnType<typeof runBackOfficeMonthlySummary>> | { error: string };
}

/**
 * Runs both monthly summaries, independently.
 *
 * Each is wrapped so one failing cannot stop the other, and so neither can
 * fail the sweep that calls them: a monthly email is not a reason for the
 * day's reminders and warnings to stop going out.
 */
export async function runMonthlySummaries(): Promise<MonthlySummaryOutcome> {
  const outcome: MonthlySummaryOutcome = {
    dailyReport: { error: 'not run' },
    backOffice: { error: 'not run' }
  };

  try {
    outcome.dailyReport = await runDailyReportMonthlySummary();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[monthly-summary] the daily-report monthly summary failed:', message);
    outcome.dailyReport = { error: message };
  }

  try {
    outcome.backOffice = await runBackOfficeMonthlySummary();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[monthly-summary] the Back Office monthly summary failed:', message);
    outcome.backOffice = { error: message };
  }

  return outcome;
}
