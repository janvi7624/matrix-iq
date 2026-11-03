import { computeDailyReportRangeSummary, aggregateRangeRowsByDepartment, DepartmentRollupRow } from './dailyReportService';
import { TeamDailyReportRangeRow } from './dailyReportTypes';
import { lastClaimableMonth } from './reimbursementPeriod';
import { monthKeyBounds } from './dateHelpers';
// Genuinely domain-agnostic month-key helpers; kept in lib/backOfficeDemoSummary.ts
// where they were first written rather than duplicated a third time.
import { monthKeyOf, monthLabelOf } from './backOfficeDemoSummary';
import { listActiveDepartments, listDepartmentManagers } from './departmentStore';
import { db } from './db';
import { sendDailyReportMonthlySummaryEmail } from './email/notifications';
import { DailyReportSummaryEmailRow } from './email/templates/dailyReportMonthlySummary';

// "Every month's 1st date, the department manager should get a monthly
// summary of last month" + "a brief to Mayank Jani of all departments, on
// mail and in dashboard both." Two jobs, one cron entry — same reasoning as
// app/api/cron/daily-report-sweep and app/api/cron/backoffice-monthly-summary
// (this app's established "no in-process scheduler, an idempotent HTTP
// endpoint an external cron calls" pattern): a daily cadence so a missed or
// delayed 1st self-heals, guarded by monthly_summary_runs so a duplicate
// cron fire never double-mails anyone.
//
// The dashboard half of "mail and in dashboard both" is a SEPARATE, live
// endpoint (app/api/dashboard/daily-report-brief/route.ts) rather than
// something this cron writes — a dashboard widget showing a stale cached
// email body would disagree with reality the moment anyone files a late
// report; computing it fresh on every visit cannot go stale.
//
// CALLED FROM the self-scheduling daily-report sweep
// (lib/dailyReportAutoSweep.ts) via lib/monthlySummaryJobs.ts, because the
// external cron this was written for was never set up and the job had
// therefore never run once. The HTTP endpoint still exists and delegates
// here, so an external cron also works:
//
//   # crontab — once a day, IST host
//   0 3 * * * curl -fsS -X POST -H "Authorization: Bearer $DAILY_REPORT_SUMMARY_CRON_SECRET" \
//     https://your-host/api/cron/daily-report-monthly-summary >> /var/log/matrixiq-daily-report-summary.log 2>&1

export const dynamic = 'force-dynamic';

const DEPARTMENT_JOB = 'daily_report_department_summary';
const ADMIN_BRIEF_JOB = 'daily_report_admin_brief';
const ADMIN_BRIEF_SCOPE = 'all';
// Mayank Jani — an explicitly named individual recipient (the request named
// him, not "whoever is admin"), resolved by username rather than role/
// capability. The in-app dashboard widget this pairs with is, deliberately,
// NOT restricted to this one username — see the dashboard route's own
// comment for why that half uses the capability instead.
const ADMIN_BRIEF_USERNAME = 'mayank';


async function claimMonth(jobKey: string, scopeKey: string, monthKey: string): Promise<boolean> {
  try {
    await db.MonthlySummaryRun.create({ job_key: jobKey, scope_key: scopeKey, month_key: monthKey } as never);
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') return false;
    throw error;
  }
}

function employeeRowToEmailRow(r: TeamDailyReportRangeRow): DailyReportSummaryEmailRow {
  return { label: r.employee_name, expected: r.expected, submitted: r.submitted, submitted_late: r.submitted_late, missing: r.missing, leave_covered: r.leave_covered, compliance_percent: r.compliance_percent };
}

function departmentRowToEmailRow(r: DepartmentRollupRow): DailyReportSummaryEmailRow {
  return { label: r.department_name, expected: r.expected, submitted: r.submitted, submitted_late: r.submitted_late, missing: r.missing, leave_covered: r.leave_covered, compliance_percent: r.compliance_percent };
}

export interface DailyReportMonthlySummaryResult {
  monthKey: string;
  monthLabel: string;
  departmentsSent: number;
  departmentsSkipped: number;
  adminBriefStatus: 'sent' | 'skipped' | 'no_recipient';
}

export async function runDailyReportMonthlySummary(): Promise<DailyReportMonthlySummaryResult> {
  const { year, month } = lastClaimableMonth();
  const monthKey = monthKeyOf(year, month);
  const monthLabel = monthLabelOf(monthKey);
  const bounds = monthKeyBounds(monthKey);
  // Half-open [from, to) from monthKeyBounds; working-day math elsewhere in
  // this module treats `to` as inclusive, so step back one day.
  const to = bounds ? new Date(new Date(bounds.to).getTime() - 86400000).toISOString().slice(0, 10) : '';
  const from = bounds?.from ?? '';

  const departments = await listActiveDepartments();
  const managersByDepartment = await listDepartmentManagers();

  let departmentsSent = 0;
  let departmentsSkipped = 0;

  for (const department of departments) {
    const managers = managersByDepartment[department.name] || [];
    if (!managers.length) continue; // nobody to send to — not an error, just nothing to do

    const claimed = await claimMonth(DEPARTMENT_JOB, department.id, monthKey);
    if (!claimed) {
      departmentsSkipped += 1;
      continue;
    }

    const summary = await computeDailyReportRangeSummary([department.id], from, to, { label: monthLabel });
    const managerUsers = await db.User.findAll({ where: { id: managers.map((m) => m.id) } as never, attributes: ['id', 'name', 'email'] });
    let sent = 0;
    for (const row of managerUsers) {
      const email = row.get('email') as string;
      if (!email) continue;
      const ok = await sendDailyReportMonthlySummaryEmail({
        email,
        name: (row.get('name') as string) || 'there',
        scope: 'department',
        scopeLabel: department.name,
        monthLabel,
        rowLabel: 'Employee',
        rows: summary.rows.map(employeeRowToEmailRow),
        totals: summary.totals
      });
      if (ok) sent += 1;
    }
    await db.MonthlySummaryRun.update({ recipient_count: sent } as never, { where: { job_key: DEPARTMENT_JOB, scope_key: department.id, month_key: monthKey } as never });
    departmentsSent += 1;
  }

  // The all-departments brief — one explicit recipient, computed from every
  // active department regardless of who manages what.
  let adminBriefStatus: 'sent' | 'skipped' | 'no_recipient' = 'skipped';
  const adminClaimed = await claimMonth(ADMIN_BRIEF_JOB, ADMIN_BRIEF_SCOPE, monthKey);
  if (adminClaimed) {
    const allDepartmentIds = departments.map((d) => d.id);
    const orgSummary = await computeDailyReportRangeSummary(allDepartmentIds, from, to, { label: monthLabel });
    const departmentRollup = aggregateRangeRowsByDepartment(orgSummary.rows);

    const recipient = await db.User.findOne({ where: { username: ADMIN_BRIEF_USERNAME, status: 'active' } as never, attributes: ['id', 'name', 'email'] });
    if (!recipient) {
      console.error(`[daily-report-summary] Admin brief recipient username "${ADMIN_BRIEF_USERNAME}" was not found or is inactive — skipping this month's all-departments brief.`);
      adminBriefStatus = 'no_recipient';
    } else {
      const email = recipient.get('email') as string;
      const ok = email
        ? await sendDailyReportMonthlySummaryEmail({
            email,
            name: (recipient.get('name') as string) || 'there',
            scope: 'organization',
            monthLabel,
            rowLabel: 'Department',
            rows: departmentRollup.map(departmentRowToEmailRow),
            totals: orgSummary.totals
          })
        : false;
      adminBriefStatus = ok ? 'sent' : 'no_recipient';
      await db.MonthlySummaryRun.update({ recipient_count: ok ? 1 : 0 } as never, { where: { job_key: ADMIN_BRIEF_JOB, scope_key: ADMIN_BRIEF_SCOPE, month_key: monthKey } as never });
    }
  }

  return { monthKey, monthLabel, departmentsSent, departmentsSkipped, adminBriefStatus };
}

