import { db } from './db';
import { ViewerContext } from './viewerContext';
import {
  DailyReportHistoryItem,
  MyDailyReportResponse,
  MyDailyReportStatus,
  TeamDailyReportResponse,
  TeamDailyReportRangeResponse,
  TeamDailyReportRangeRow,
  TeamDailyReportRow
} from './dailyReportTypes';
import { getDailyReportConfig, getDeadlinePolicy } from './dailyReportConfigStore';
import { resolveTemplateForDepartment } from './dailyReportTemplateStore';
import { buildHistory, findReportForDate, listRevisions, loadReportStatuses, SUBMITTED_STATUSES } from './dailyReportStore';
import { findLiveClaim, loadClaimStatusByDate, loadLeaveCoveredKeys } from './dailyReportLeaveClaimStore';
import { buildWarningSummary, loadWarningStatusByDate, loadWarningKeys } from './dailyReportWarningStore';
import { EligibleEmployee, employeeOwesDate, listEligibleEmployees } from './dailyReportEligibility';
import { resolveDailyReportScope } from './dailyReportAccess';
import { addDays, isWorkingDay, istDate, missingIsVisibleYet, monthKey, navigableWorkingDays, scheduleFor, workingDaysBetween } from './dailyReportTime';
import { computeSalesAutoMatrix, mergeAutoMatrix } from './salesDailyAutoFetch';
import { computeGemProposalEntries, mergeAutoGemEntries } from './gemProposalAutoFetch';
import { computeDerivedValues, isEntryOverdue } from './dailyReportTemplates';

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
  const today = istDate(new Date());
  // A future date is clamped rather than refused. The picker and the arrows
  // already prevent it, so anything arriving here is a hand-edited URL or a
  // stale link — landing on today is friendlier than an error, and the write
  // paths reject a future date independently anyway (see saveReport).
  const requested = date || today;
  const reportDate = requested > today ? today : requested;
  const schedule = scheduleFor(reportDate, policy);
  const navigation = navigableWorkingDays(reportDate, today, policy);
  const resolved = await resolveTemplateForDepartment(employee.departmentId);

  // The strip is anchored to TODAY, not to the selected date.
  //
  // Anchoring it to the selection was a real bug: the selected day was
  // always the newest entry, so there was never a later day to step to and
  // the forward arrow could not be enabled — you could walk back through
  // history and never come forward again. Anchoring to today makes the strip
  // stable navigation (the same fourteen days whatever you are viewing) and
  // makes the tally built from it mean "your recent working days" rather
  // than "the fourteen days before whatever you clicked".
  //
  // Still WORKING days, so it shows fourteen days somebody could actually
  // have filed rather than fourteen calendar days of which two are Sundays.
  const historyFrom = addDays(today, -Math.ceil(HISTORY_WORKING_DAYS * 1.5) - 7);
  const historyDates = workingDaysBetween(historyFrom, today, policy).slice(-HISTORY_WORKING_DAYS);
  // The selected date can sit outside that window (someone jumped back a
  // month with the picker), and the claim/warning lookups below must still
  // cover it — otherwise its own leave and warning state would read as absent.
  const lookupFrom = historyDates[0] && historyDates[0] < reportDate ? historyDates[0] : reportDate;
  const lookupTo = today > reportDate ? today : reportDate;

  const [report, leaveClaim, warnings, leaveByDate, warningByDate] = await Promise.all([
    findReportForDate(employee.id, employee.departmentId, reportDate),
    findLiveClaim(employee.id, reportDate),
    buildWarningSummary(employee.id, monthKey(reportDate), config.warning_threshold),
    loadClaimStatusByDate(employee.id, lookupFrom, lookupTo),
    loadWarningStatusByDate(employee.id, lookupFrom, lookupTo)
  ]);

  const history = await buildHistory(employee.id, historyDates, leaveByDate, warningByDate);
  const revisions = report ? await listRevisions(report.id) : [];

  const submitted = !!report && SUBMITTED_STATUSES.includes(report.submission_status);

  // Live preview of the 4 auto measures (lib/salesDailyAutoFetch.ts) for as
  // long as the day is still open — so the employee sees today's real
  // numbers building up through the day, not just at submit time
  // (saveReport() already recomputes and overlays the same way on every
  // save/submit regardless of whether this ran, so this is a read-only
  // preview, never the only place correctness comes from).
  //
  // Computed whether or not a draft already exists: the FIRST visit to an
  // unstarted day has no `report` to merge into, and without this the
  // employee would see blanks under the "Auto" badge until they saved a
  // draft once — exactly backwards for a feature whose point is "no manual
  // entry needed". See auto_preview on the response for the no-report case.
  let autoPreview: Record<string, Record<string, number>> | null = null;
  if (!submitted && resolved.template.layout === 'matrix' && resolved.template.autoMeasures?.length) {
    autoPreview = await computeSalesAutoMatrix(employee.id, reportDate, resolved.template.autoMeasures, resolved.template.channels ?? []);
    if (report) report.matrix = mergeAutoMatrix(report.matrix, autoPreview);
  }

  // GEM Sales' Proposal Creation rows — the rows-layout counterpart to the
  // matrix preview above, and for the identical reason: the first visit to
  // an unstarted day has no `report.entries` to merge into, so this is
  // computed whether or not a draft already exists. See
  // gem_entries_preview on the response for the no-report case.
  let gemEntriesPreview: Record<string, unknown>[] | null = null;
  if (!submitted && resolved.template.layout === 'rows' && resolved.template.autoEntryActivity) {
    const autoEntries = await computeGemProposalEntries(employee.id, employee.name, reportDate);
    const existingData = report ? report.entries.map((e) => e.data) : [];
    const mergedData = mergeAutoGemEntries(existingData, autoEntries);
    gemEntriesPreview = mergedData;
    if (report) {
      report.entries = mergedData.map((data, index) => ({
        id: report!.entries[index]?.id ?? '',
        position: index,
        data,
        derived: computeDerivedValues(resolved.template, reportDate, data, index, today),
        overdue: isEntryOverdue(resolved.template, reportDate, data, index, today)
      }));
    }
  }

  return {
    report_date: reportDate,
    is_working_day: isWorkingDay(reportDate, policy),
    deadline_at: schedule.deadlineAt.toISOString(),
    deadline_date: schedule.deadlineDate,
    // Deliberately false once something is submitted: the banner's job is to
    // warn about an outstanding report, and the report's own
    // SUBMITTED_LATE badge already says it went in late.
    past_deadline: !submitted && Date.now() > schedule.deadlineAt.getTime(),
    // `next` comes back '' once it would be in the future — see
    // navigableWorkingDays, which owns that rule and is unit-tested.
    prev_working_day: navigation.prev,
    next_working_day: navigation.next,
    today,
    employee: { id: employee.id, name: employee.name, username: employee.username, department_name: employee.departmentName },
    template: resolved.template,
    template_configured: resolved.configured,
    exempt: config.exempt_employee_ids.includes(employee.id),
    report,
    auto_preview: autoPreview,
    gem_entries_preview: gemEntriesPreview,
    revisions,
    leave_claim: leaveClaim,
    warnings,
    history
  };
}

/**
 * "Should this person be asked to file today, and have they." Nothing more.
 *
 * Kept separate from buildMyDailyReport — which loads the template, a
 * fortnight of history, the month's warning summary and the revision list —
 * because the dashboard shortcut runs on a screen every person opens on
 * every visit. Three lookups, not nine.
 *
 * Every `required: false` branch mirrors a rule the scheduler already
 * applies, so the shortcut can never prompt somebody the module itself does
 * not expect a report from.
 */
export async function buildMyDailyReportStatus(employeeId: string): Promise<MyDailyReportStatus> {
  const policy = await getDeadlinePolicy();
  const reportDate = istDate(new Date());
  const schedule = scheduleFor(reportDate, policy);

  const base: MyDailyReportStatus = {
    required: false,
    not_required_reason: '',
    report_date: reportDate,
    submission_status: 'MISSING',
    deadline_at: schedule.deadlineAt.toISOString(),
    past_deadline: false
  };

  const employee = await resolveEmployeeIdentity(employeeId);
  // Superadmin accounts carry no department at all — there is no format to
  // file, so there is nothing to prompt them about.
  if (!employee?.departmentId) return { ...base, not_required_reason: 'no_department' };

  const config = await getDailyReportConfig();
  if (config.exempt_employee_ids.includes(employee.id)) return { ...base, not_required_reason: 'exempt' };

  const resolved = await resolveTemplateForDepartment(employee.departmentId);
  if (!resolved.configured) return { ...base, not_required_reason: 'not_configured' };

  const report = await findReportForDate(employee.id, employee.departmentId, reportDate);
  const filed = report ? report.submission_status : 'MISSING';

  // Not a working day, or already excused by a pending/approved leave claim.
  // Both are rules the scheduler applies, so prompting here would be the
  // shortcut contradicting the module. A report filed anyway is still
  // reported, rather than claiming nothing happened.
  if (!isWorkingDay(reportDate, policy) || (await findLiveClaim(employee.id, reportDate))) {
    return { ...base, not_required_reason: 'non_working_day', submission_status: filed };
  }

  const submitted = !!report && SUBMITTED_STATUSES.includes(report.submission_status);
  return {
    ...base,
    required: true,
    submission_status: filed,
    past_deadline: !submitted && Date.now() > schedule.deadlineAt.getTime()
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
      // Not filed splits two ways: MISSING once the day is genuinely past
      // being open, PENDING while it still is. See missingIsVisibleYet.
      submission_status: isSubmitted
        ? (found as NonNullable<typeof found>).submission_status
        : missingIsVisibleYet(reportDate, new Date())
          ? 'MISSING'
          : 'PENDING',
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
        // Tested positively, not as "not missing" — PENDING is also not
        // missing, and it certainly is not submitted.
        return SUBMITTED_STATUSES.includes(row.submission_status as (typeof SUBMITTED_STATUSES)[number]);
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
    submitted: rows.filter((r) => SUBMITTED_STATUSES.includes(r.submission_status as (typeof SUBMITTED_STATUSES)[number])).length,
    submitted_late: rows.filter((r) => r.submission_status === 'SUBMITTED_LATE').length,
    missing: rows.filter((r) => r.submission_status === 'MISSING' && !leaveCovered.has(`${r.employee_id}|${reportDate}`)).length,
    // Not filed, but the day is still open. Reported so expected still adds
    // up: without it a manager sees 30 expected, 2 submitted, 0 missing and
    // has no idea where the other 28 went.
    pending: rows.filter((r) => r.submission_status === 'PENDING' && !leaveCovered.has(`${r.employee_id}|${reportDate}`)).length,
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

export interface RangeSummaryOptions {
  label?: string;
  search?: string;
}

/**
 * The viewer-independent core: "how did these departments do between these
 * two dates" — compliance COUNTS per employee, not TeamDailyReportRow's
 * one-row-per-employee-for-one-day roster, because "who is missing right
 * now" stops meaning anything once more than one day is in view.
 *
 * Split out from buildTeamDailyReportsRange (below, which resolves a VIEWER's
 * scope and delegates here) specifically so the monthly summary cron —
 * app/api/cron/daily-report-monthly-summary — can compute the exact same
 * numbers for an explicit department list with no logged-in viewer to scope
 * from at all. The screen and the mailbox can then never disagree, because
 * both ultimately call this one function.
 */
export async function computeDailyReportRangeSummary(
  departmentIds: string[],
  from: string,
  to: string,
  options: RangeSummaryOptions = {}
): Promise<TeamDailyReportRangeResponse> {
  const policy = await getDeadlinePolicy();
  const employees = departmentIds.length ? await listEligibleEmployees(departmentIds) : [];
  const employeeIds = employees.map((e) => e.id);
  const dates = workingDaysBetween(from, to, policy);

  const [statuses, leaveCovered] = await Promise.all([
    loadReportStatuses(employeeIds, from, to),
    loadLeaveCoveredKeys(employeeIds, from, to)
  ]);

  let rows: TeamDailyReportRangeRow[] = employees.map((employee) => {
    const owedDates = dates.filter((d) => employeeOwesDate(employee, d));
    let submitted = 0;
    let submittedLate = 0;
    let leaveCoveredCount = 0;
    for (const d of owedDates) {
      const key = `${employee.id}|${d}`;
      const found = statuses.get(key);
      if (found && SUBMITTED_STATUSES.includes(found.submission_status)) {
        submitted += 1;
        if (found.is_late) submittedLate += 1;
      } else if (leaveCovered.has(key)) {
        leaveCoveredCount += 1;
      }
    }
    const expected = owedDates.length;
    const missing = Math.max(0, expected - submitted - leaveCoveredCount);
    return {
      employee_id: employee.id,
      employee_name: employee.name,
      employee_username: employee.username,
      department_id: employee.departmentId,
      department_name: employee.departmentName,
      expected,
      submitted,
      submitted_late: submittedLate,
      missing,
      leave_covered: leaveCoveredCount,
      // Leave counts as neither a compliance hit nor a credit — it is
      // excluded from the denominator, same as it already reads on the
      // single-date view (On leave is its own badge, not Missing).
      compliance_percent: expected - leaveCoveredCount > 0 ? Math.round((submitted / (expected - leaveCoveredCount)) * 100) : 100
    };
  });

  const search = (options.search ?? '').trim().toLowerCase();
  if (search) {
    rows = rows.filter((row) => `${row.employee_name} ${row.employee_username} ${row.department_name}`.toLowerCase().includes(search));
  }
  rows.sort((a, b) => a.department_name.localeCompare(b.department_name) || a.employee_name.localeCompare(b.employee_name));

  const totals = rows.reduce(
    (acc, r) => ({
      expected: acc.expected + r.expected,
      submitted: acc.submitted + r.submitted,
      submitted_late: acc.submitted_late + r.submitted_late,
      missing: acc.missing + r.missing,
      leave_covered: acc.leave_covered + r.leave_covered
    }),
    { expected: 0, submitted: 0, submitted_late: 0, missing: 0, leave_covered: 0 }
  );

  // Every department actually represented in the (unfiltered-by-search)
  // employee set — for the UI's filter dropdown, this is the same set as the
  // viewer's own scope.departments by construction, since the wrapper below
  // passes exactly scope.departmentIds in.
  const departmentMap = new Map<string, string>();
  for (const e of employees) if (e.departmentId) departmentMap.set(e.departmentId, e.departmentName);
  const departments = Array.from(departmentMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return { from, to, label: options.label ?? `${from} – ${to}`, rows, totals, departments };
}

export interface TeamRangeFilters {
  from: string;
  to: string;
  label?: string;
  departmentId?: string;
  search?: string;
}

/**
 * "How did my team do over [a month/quarter/year/custom range]" — the
 * filters this was built for (Daily Report filter: Employee search, Month,
 * Quarter, Year, Custom Range), scoped to whatever this viewer may see.
 * The actual computation is computeDailyReportRangeSummary above.
 */
export async function buildTeamDailyReportsRange(viewer: ViewerContext, filters: TeamRangeFilters): Promise<TeamDailyReportRangeResponse> {
  const scope = await resolveDailyReportScope(viewer);
  const departmentIds = filters.departmentId && scope.departmentIds.includes(filters.departmentId) ? [filters.departmentId] : scope.departmentIds;
  return computeDailyReportRangeSummary(departmentIds, filters.from, filters.to, { label: filters.label, search: filters.search });
}

export interface DepartmentRollupRow {
  department_id: string;
  department_name: string;
  expected: number;
  submitted: number;
  submitted_late: number;
  missing: number;
  leave_covered: number;
  compliance_percent: number;
}

// Per-employee rows -> one row per department. Pure (no DB) — built for the
// all-departments admin brief, where a per-EMPLOYEE table across the whole
// company would be a wall of rows nobody reads; a department manager's own
// monthly email stays per-employee (TeamDailyReportRangeRow as-is), since
// that is the one actually actionable at that level.
export function aggregateRangeRowsByDepartment(rows: TeamDailyReportRangeRow[]): DepartmentRollupRow[] {
  const byDept = new Map<string, DepartmentRollupRow>();
  for (const r of rows) {
    let bucket = byDept.get(r.department_id);
    if (!bucket) {
      bucket = { department_id: r.department_id, department_name: r.department_name, expected: 0, submitted: 0, submitted_late: 0, missing: 0, leave_covered: 0, compliance_percent: 0 };
      byDept.set(r.department_id, bucket);
    }
    bucket.expected += r.expected;
    bucket.submitted += r.submitted;
    bucket.submitted_late += r.submitted_late;
    bucket.missing += r.missing;
    bucket.leave_covered += r.leave_covered;
  }
  const result = Array.from(byDept.values());
  for (const b of result) {
    const denominator = b.expected - b.leave_covered;
    b.compliance_percent = denominator > 0 ? Math.round((b.submitted / denominator) * 100) : 100;
  }
  return result.sort((a, b) => a.department_name.localeCompare(b.department_name));
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
