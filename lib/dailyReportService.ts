import { db } from './db';
import { ViewerContext } from './viewerContext';
import {
  DailyReportHistoryItem,
  MyDailyReportResponse,
  TeamDailyReportResponse,
  TeamDailyReportRow
} from './dailyReportTypes';
import { getDailyReportConfig, getDeadlinePolicy } from './dailyReportConfigStore';
import { resolveTemplateForDepartment } from './dailyReportTemplateStore';
import { buildHistory, findReportForDate, listRevisions, loadReportStatuses, SUBMITTED_STATUSES } from './dailyReportStore';
import { findLiveClaim, loadClaimStatusByDate, loadLeaveCoveredKeys } from './dailyReportLeaveClaimStore';
import { buildWarningSummary, loadWarningStatusByDate, loadWarningKeys } from './dailyReportWarningStore';
import { EligibleEmployee, employeeOwesDate, listEligibleEmployees } from './dailyReportEligibility';
import { resolveDailyReportScope } from './dailyReportAccess';
import { addDays, isWorkingDay, istDate, monthKey, scheduleFor, workingDaysBetween } from './dailyReportTime';

// The two composite reads behind the employee page and the manager
// dashboard. Both live here rather than in their route handlers because the
// page (a server component) and the API need the identical payload, and
// because each pulls together five stores — doing that twice would be two
// chances for the page and the endpoint to disagree about, say, whether a
// draft counts as filed.

/** How many recent reporting days the history strip shows. */
const HISTORY_WORKING_DAYS = 14;

export interface EmployeeIdentity {
  id: string;
  username: string;
  name: string;
  departmentId: string;
  departmentName: string;
}

export async function resolveEmployeeIdentity(userId: string): Promise<EmployeeIdentity | null> {
  const row = await db.User.findByPk(userId, {
    attributes: ['id', 'username', 'name', 'departmentId', 'department'],
    include: [{ model: db.Department, as: 'departmentRef', attributes: ['id', 'name'] }] as never
  });
  if (!row) return null;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const ref = plain.departmentRef as { id?: string; name?: string } | null;
  return {
    id: plain.id as string,
    username: plain.username as string,
    name: (plain.name as string) || (plain.username as string),
    departmentId: (ref?.id as string) ?? ((plain.departmentId as string) || ''),
    // Falls back to users.department (the free-text column kept in sync by
    // the user store) so an account whose departmentId FK was never
    // backfilled still shows a department name rather than a blank.
    departmentName: ref?.name ?? ((plain.department as string) || '')
  };
}

/**
 * Everything one employee's Daily Report page needs for one reporting date.
 *
 * `date` is an IST calendar day and defaults to today in IST — not the
 * server's today, which is a different day for 5½ hours of every night.
 */
export async function buildMyDailyReport(employee: EmployeeIdentity, date?: string): Promise<MyDailyReportResponse> {
  const config = await getDailyReportConfig();
  const policy = await getDeadlinePolicy();
  const reportDate = date || istDate(new Date());
  const schedule = scheduleFor(reportDate, policy);
  const resolved = await resolveTemplateForDepartment(employee.departmentId);

  // The history strip walks back over WORKING days, so it shows fourteen
  // days somebody could actually have filed rather than fourteen calendar
  // days of which two are Sundays.
  const historyFrom = addDays(reportDate, -Math.ceil(HISTORY_WORKING_DAYS * 1.5) - 7);
  const historyDates = workingDaysBetween(historyFrom, reportDate, policy).slice(-HISTORY_WORKING_DAYS);

  const [report, leaveClaim, warnings, leaveByDate, warningByDate] = await Promise.all([
    findReportForDate(employee.id, employee.departmentId, reportDate),
    findLiveClaim(employee.id, reportDate),
    buildWarningSummary(employee.id, monthKey(reportDate), config.warning_threshold),
    loadClaimStatusByDate(employee.id, historyDates[0] ?? reportDate, reportDate),
    loadWarningStatusByDate(employee.id, historyDates[0] ?? reportDate, reportDate)
  ]);

  const history = await buildHistory(employee.id, historyDates, leaveByDate, warningByDate);
  const revisions = report ? await listRevisions(report.id) : [];

  const submitted = !!report && SUBMITTED_STATUSES.includes(report.submission_status);

  return {
    report_date: reportDate,
    is_working_day: isWorkingDay(reportDate, policy),
    deadline_at: schedule.deadlineAt.toISOString(),
    deadline_date: schedule.deadlineDate,
    // Deliberately false once something is submitted: the banner's job is to
    // warn about an outstanding report, and the report's own
    // SUBMITTED_LATE badge already says it went in late.
    past_deadline: !submitted && Date.now() > schedule.deadlineAt.getTime(),
    employee: { id: employee.id, name: employee.name, username: employee.username, department_name: employee.departmentName },
    template: resolved.template,
    template_configured: resolved.configured,
    report,
    revisions,
    leave_claim: leaveClaim,
    warnings,
    history
  };
}

export interface TeamFilters {
  date?: string;
  departmentId?: string;
  search?: string;
  /** 'all' | 'submitted' | 'late' | 'missing' | 'leave' */
  status?: string;
}

/**
 * The manager dashboard for one reporting date.
 *
 * Built from the EXPECTED set (every eligible employee in scope) rather than
 * from the reports that exist, because the whole point of the screen is who
 * is missing. A query over daily_reports alone can only ever show the people
 * who complied.
 *
 * Draft contents never appear here, and a draft reads as MISSING: a draft is
 * private to its owner and does not satisfy the filing requirement, so
 * showing it as a partial submission would both leak it and overstate
 * compliance.
 */
export async function buildTeamDailyReports(viewer: ViewerContext, filters: TeamFilters = {}): Promise<TeamDailyReportResponse> {
  const policy = await getDeadlinePolicy();
  const reportDate = filters.date || istDate(new Date());
  const schedule = scheduleFor(reportDate, policy);
  const scope = await resolveDailyReportScope(viewer);

  // Narrowing to one department is only ever allowed WITHIN the viewer's own
  // scope — a department id in the query string can't widen it.
  const departmentIds = filters.departmentId && scope.departmentIds.includes(filters.departmentId) ? [filters.departmentId] : scope.departmentIds;

  const employees = departmentIds.length ? await listEligibleEmployees(departmentIds) : [];
  const owed = employees.filter((e) => employeeOwesDate(e, reportDate));
  const employeeIds = owed.map((e) => e.id);

  const [statuses, leaveCovered, warningKeys, claimStatuses] = await Promise.all([
    loadReportStatuses(employeeIds, reportDate, reportDate),
    loadLeaveCoveredKeys(employeeIds, reportDate, reportDate),
    loadWarningKeys(employeeIds, reportDate, reportDate),
    loadClaimStatusForMany(employeeIds, reportDate)
  ]);

  const rows: TeamDailyReportRow[] = owed.map((employee) => {
    const key = `${employee.id}|${reportDate}`;
    const found = statuses.get(key);
    const isSubmitted = !!found && SUBMITTED_STATUSES.includes(found.submission_status);
    return {
      employee_id: employee.id,
      employee_name: employee.name,
      employee_username: employee.username,
      department_id: employee.departmentId,
      department_name: employee.departmentName,
      report_date: reportDate,
      template_key: employee.templateKey,
      template_configured: true,
      submission_status: isSubmitted ? (found as NonNullable<typeof found>).submission_status : 'MISSING',
      submitted_at: isSubmitted ? (found as NonNullable<typeof found>).submitted_at : '',
      is_late: isSubmitted ? (found as NonNullable<typeof found>).is_late : false,
      review_status: isSubmitted ? (found as NonNullable<typeof found>).review_status : '',
      leave_status: claimStatuses.get(key) ?? '',
      warning_status: warningKeys.has(key) ? 'ACTIVE' : '',
      filed_by_name: isSubmitted ? (found as NonNullable<typeof found>).filed_by_name : '',
      // Only a SUBMITTED report is addressable from here. A draft's id is
      // withheld so there is no id to fetch its contents with.
      report_id: isSubmitted ? (found as NonNullable<typeof found>).id : null,
      entry_count: isSubmitted ? (found as NonNullable<typeof found>).entry_count : 0
    };
  });

  const search = (filters.search ?? '').trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (search && !`${row.employee_name} ${row.employee_username} ${row.department_name}`.toLowerCase().includes(search)) return false;
    switch (filters.status) {
      case 'submitted':
        return row.submission_status !== 'MISSING';
      case 'late':
        return row.submission_status === 'SUBMITTED_LATE';
      case 'missing':
        return row.submission_status === 'MISSING' && !row.leave_status;
      case 'leave':
        return !!row.leave_status;
      default:
        return true;
    }
  });

  // KPIs are computed over the UNFILTERED set: "4 missing" has to mean four
  // missing today, not four missing among the rows that match a search box.
  const kpis = {
    expected: rows.length,
    submitted: rows.filter((r) => r.submission_status !== 'MISSING').length,
    submitted_late: rows.filter((r) => r.submission_status === 'SUBMITTED_LATE').length,
    missing: rows.filter((r) => r.submission_status === 'MISSING' && !leaveCovered.has(`${r.employee_id}|${reportDate}`)).length,
    pending_leave: rows.filter((r) => r.leave_status === 'PENDING').length,
    approved_leave: rows.filter((r) => r.leave_status === 'APPROVED').length,
    // Active employees in scope who are NOT expected to file today —
    // because their department has no approved format, or because they
    // joined after this date. Reported rather than hidden, so a manager can
    // see why their headcount and their expected count differ instead of
    // assuming the page has lost somebody.
    not_configured: Math.max(0, (await countInScopeEmployees(departmentIds)) - rows.length)
  };

  return {
    report_date: reportDate,
    is_working_day: isWorkingDay(reportDate, policy),
    deadline_at: schedule.deadlineAt.toISOString(),
    rows: filtered.sort(
      (a, b) =>
        // Missing first: the actionable rows belong at the top.
        Number(b.submission_status === 'MISSING') - Number(a.submission_status === 'MISSING') ||
        a.department_name.localeCompare(b.department_name) ||
        a.employee_name.localeCompare(b.employee_name)
    ),
    kpis,
    departments: scope.departments,
    can_file_for_others: scope.canFileForOthers
  };
}

// Declared after use above by hoisting — kept down here so the two exported
// builders read top-to-bottom.
async function loadClaimStatusForMany(employeeIds: string[], reportDate: string): Promise<Map<string, TeamDailyReportRow['leave_status']>> {
  const map = new Map<string, TeamDailyReportRow['leave_status']>();
  if (!employeeIds.length) return map;
  const rows = await db.DailyReportLeaveClaim.findAll({
    where: { employee_id: employeeIds, report_date: reportDate } as never,
    attributes: ['employee_id', 'status'],
    order: [['createdAt', 'ASC']]
  });
  for (const row of rows) {
    map.set(`${row.get('employee_id') as string}|${reportDate}`, row.get('status') as TeamDailyReportRow['leave_status']);
  }
  return map;
}

async function countInScopeEmployees(departmentIds: string[]): Promise<number> {
  if (!departmentIds.length) return 0;
  return db.User.count({ where: { departmentId: departmentIds, status: 'active' } as never });
}

/** The employee history strip, for a manager looking at one team member. */
export async function buildEmployeeHistory(employee: EligibleEmployee | EmployeeIdentity, upToDate: string, days = HISTORY_WORKING_DAYS): Promise<DailyReportHistoryItem[]> {
  const policy = await getDeadlinePolicy();
  const from = addDays(upToDate, -Math.ceil(days * 1.5) - 7);
  const dates = workingDaysBetween(from, upToDate, policy).slice(-days);
  if (!dates.length) return [];
  const [leaveByDate, warningByDate] = await Promise.all([
    loadClaimStatusByDate(employee.id, dates[0], upToDate),
    loadWarningStatusByDate(employee.id, dates[0], upToDate)
  ]);
  return buildHistory(employee.id, dates, leaveByDate, warningByDate);
}
