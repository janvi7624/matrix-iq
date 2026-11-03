import { getBackOfficeDemoSummary, monthKeyOf } from './backOfficeDemoSummary';
import { lastClaimableMonth } from './reimbursementPeriod';
import { listDepartmentManagers } from './departmentStore';
import { db } from './db';
import { logAudit } from './auditLogStore';
import { sendBackOfficeMonthlySummaryEmail } from './email/notifications';

// "Every month's 1st date the Back Office manager should get a mail of
// summary of last month" — the exact pattern app/api/cron/daily-report-sweep
// already established for this app's one and only scheduled-job mechanism
// (see that file's header comment): this app has no in-process scheduler, so
// an external cron on the VPS calls this idempotent HTTP endpoint instead.
//
// Recommended cadence: daily, not just on the 1st — exactly like the daily
// report sweep, this endpoint works out what is actually due rather than
// trusting it's called at an exact instant, so a missed or delayed 1st still
// self-heals on the next call. The guard is a unique index on month_key in
// back_office_monthly_summary_runs — NOT audit_logs, whose entity_id is a
// genuine UUID column and can't hold a 'YYYY-MM' key — claimed BEFORE
// sending, the same claim-then-act idiom lib/dailyReportNotify.ts's
// claimNotificationEvent uses, so two overlapping cron calls can't both pass
// the gate.
//
// CALLED FROM the self-scheduling daily-report sweep
// (lib/dailyReportAutoSweep.ts) via lib/monthlySummaryJobs.ts — the external
// cron this was written for was never set up, so this job had never run and
// Back Office had never received a monthly summary. The HTTP endpoint still
// delegates here, so an external cron also works:
//
//   # crontab — once a day, IST host
//   0 2 * * * curl -fsS -X POST -H "Authorization: Bearer $BACKOFFICE_SUMMARY_CRON_SECRET" \
//     https://your-host/api/cron/backoffice-monthly-summary >> /var/log/matrixiq-backoffice-summary.log 2>&1
//
// AUTH. Same shape as daily-report-sweep: a cron process carries no session
// cookie, so this route is in proxy.ts's PUBLIC_PATHS and authenticates with
// a shared secret instead. Fails closed (503) if the secret env var is
// unset — an unauthenticated endpoint that emails management must refuse
// every request rather than quietly accept any caller.

export const dynamic = 'force-dynamic';

// The claim itself: create() racing the unique index on month_key. A
// SequelizeUniqueConstraintError means some call (this one or an earlier
// one) already claimed this month — treated as "already sent," never
// retried blindly, matching claimNotificationEvent's exact contract.
async function claimMonth(monthKey: string): Promise<boolean> {
  try {
    await db.BackOfficeMonthlySummaryRun.create({ month_key: monthKey } as never);
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') return false;
    throw error;
  }
}

export interface BackOfficeMonthlySummaryResult {
  status: 'ok' | 'skipped' | 'failed' | 'no_recipients';
  monthKey: string;
  managerCount: number;
  sent: number;
  totals?: { demoCount: number; totalExpense: number };
}

export async function runBackOfficeMonthlySummary(): Promise<BackOfficeMonthlySummaryResult> {
  const { year, month } = lastClaimableMonth();
  const monthKey = monthKeyOf(year, month);

  const claimed = await claimMonth(monthKey);
  if (!claimed) {
    return { status: 'skipped', monthKey, managerCount: 0, sent: 0 };
  }

  const report = await getBackOfficeDemoSummary({ period: monthKey, trendMonths: 1 });

  const managers = (await listDepartmentManagers())['Back Office'] || [];
  const managerUsers = managers.length
    ? await db.User.findAll({ where: { id: managers.map((m) => m.id) } as never, attributes: ['id', 'name', 'email'] })
    : [];

  let sent = 0;
  for (const row of managerUsers) {
    const email = row.get('email') as string;
    const name = (row.get('name') as string) || 'there';
    if (!email) continue;
    const ok = await sendBackOfficeMonthlySummaryEmail({
      email,
      name,
      monthLabel: report.label,
      rows: report.rows,
      totals: report.totals
    });
    if (ok) sent += 1;
  }

  // Fill in the claim row with what actually happened — it was inserted at
  // zero/defaults the moment the month was claimed, before any of this was
  // known.
  await db.BackOfficeMonthlySummaryRun.update(
    { recipient_count: sent, demo_count: report.totals.demoCount, total_expense: report.totals.totalExpense } as never,
    { where: { month_key: monthKey } as never }
  );

  // Also a normal, human-readable audit trail entry (entity_id left blank —
  // audit_logs.entity_id is a UUID column with nothing real to point at
  // here; the month lives in remarks instead), so an admin browsing Audit
  // Log sees this alongside every other Back Office action.
  await logAudit({
    by: 'system',
    role: 'system',
    entityType: 'back_office_monthly_summary',
    entityId: '',
    action: 'Monthly summary emailed',
    previousStatus: '',
    newStatus: '',
    remarks: `${report.label}: ${report.totals.demoCount} demo(s), ${report.totals.totalExpense} expense, sent to ${sent} of ${managerUsers.length} Back Office manager(s)`
  });

  return {
    status: managers.length === 0 ? 'no_recipients' : sent === 0 ? 'failed' : 'ok',
    monthKey,
    managerCount: managers.length,
    sent,
    totals: report.totals
  };
}
