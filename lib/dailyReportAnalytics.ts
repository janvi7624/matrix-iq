import { DailyReportAnalyticsResponse, DailyReportAnalyticsRow } from './dailyReportTypes';
import { getDeadlinePolicy } from './dailyReportConfigStore';
import { EligibleEmployee, employeeOwesDate, listEligibleEmployees } from './dailyReportEligibility';
import { countReportsByStatus } from './dailyReportStore';
import { countClaimsByStatus } from './dailyReportLeaveClaimStore';
import { countWarningsByStatus } from './dailyReportWarningStore';
import { monthKeyBounds } from './dateHelpers';
import { addDays, workingDaysBetween } from './dailyReportTime';

// Monthly and department-level compliance.
//
// The numbers here are computed from the SAME three sources the scheduler
// acts on — the eligibility rule (lib/dailyReportEligibility.ts), the
// working-day/deadline policy (lib/dailyReportTime.ts), and the
// submission/leave/warning tables — rather than from a separate reporting
// query. That is deliberate and is the brief's "analytics must use the same
// authoritative deadline, leave and warning rules as the scheduler": a
// dashboard that computes "expected" differently from the job that issues
// warnings produces a compliance percentage nobody can reconcile with the
// warning ledger, and the warning ledger is the one that emails people.
//
// "Expected" therefore means exactly what the scheduler means by it:
//   working days in the month
//   × active employees in a department with a CONFIGURED template
//   − days before an employee's joining date
// Accounts and any unassigned department contribute 0 expected and 0
// missing, and are reported separately as not-configured rather than being
// silently counted as 100% or 0% compliant.

function emptyRow(key: string, label: string): DailyReportAnalyticsRow {
  return {
    key,
    label,
    expected: 0,
    submitted_on_time: 0,
    submitted_late: 0,
    missing: 0,
    compliance_percent: 0,
    active_warnings: 0,
    waived_warnings: 0,
    pending_leave: 0,
    approved_leave: 0,
    manager_filed: 0
  };
}

function finalise(row: DailyReportAnalyticsRow): DailyReportAnalyticsRow {
  const submitted = row.submitted_on_time + row.submitted_late;
  // Approved leave reduces the denominator rather than counting as a miss:
  // a day somebody was legitimately away is not a compliance failure, and
  // counting it as one would make the percentage argue with the warning
  // ledger (which waives exactly those dates).
  const denominator = Math.max(0, row.expected - row.approved_leave);
  row.missing = Math.max(0, denominator - submitted);
  row.compliance_percent = denominator === 0 ? 100 : Math.round((submitted / denominator) * 1000) / 10;
  return row;
}

export interface AnalyticsFilters {
  /** 'YYYY-MM'. Defaults to the current IST month. */
  monthKey: string;
  /** Narrows to a manager's scope. Empty/undefined means every department. */
  departmentIds?: string[];
  /** Narrows to one employee, for the employee-wise history view. */
  employeeId?: string;
}

export async function buildDailyReportAnalytics(filters: AnalyticsFilters): Promise<DailyReportAnalyticsResponse> {
  const bounds = monthKeyBounds(filters.monthKey);
  if (!bounds) throw new Error('A valid month (YYYY-MM) is required.');
  const from = bounds.from;
  // monthKeyBounds returns a half-open [from, to) range; the daily-report
  // queries are inclusive BETWEEN, so step back one day rather than
  // double-counting the first of the next month.
  const to = addDays(bounds.to, -1);

  const policy = await getDeadlinePolicy();
  const workingDays = workingDaysBetween(from, to, policy);

  let employees = await listEligibleEmployees(filters.departmentIds?.length ? filters.departmentIds : undefined);
  if (filters.employeeId) employees = employees.filter((e) => e.id === filters.employeeId);

  const totals = emptyRow('all', 'All departments');
  const byDepartment = new Map<string, DailyReportAnalyticsRow>();
  const byEmployee = new Map<string, DailyReportAnalyticsRow>();

  const expectedFor = (employee: EligibleEmployee): number => workingDays.filter((d) => employeeOwesDate(employee, d)).length;

  for (const employee of employees) {
    const expected = expectedFor(employee);
    if (!byDepartment.has(employee.departmentId)) byDepartment.set(employee.departmentId, emptyRow(employee.departmentId, employee.departmentName));
    const department = byDepartment.get(employee.departmentId) as DailyReportAnalyticsRow;
    const row = emptyRow(employee.id, employee.name);
    row.expected = expected;
    byEmployee.set(employee.id, row);
    department.expected += expected;
    totals.expected += expected;
  }

  const employeeIds = employees.map((e) => e.id);
  const departmentByEmployee = new Map(employees.map((e) => [e.id, e.departmentId]));

  const add = (employeeId: string, field: keyof DailyReportAnalyticsRow, count: number) => {
    const employeeRow = byEmployee.get(employeeId);
    if (!employeeRow) return;
    (employeeRow[field] as number) += count;
    const departmentRow = byDepartment.get(departmentByEmployee.get(employeeId) as string);
    if (departmentRow) (departmentRow[field] as number) += count;
    (totals[field] as number) += count;
  };

  if (employeeIds.length) {
    const [reports, claims, warnings] = await Promise.all([
      countReportsByStatus(employeeIds, from, to),
      countClaimsByStatus(employeeIds, from, to),
      countWarningsByStatus(employeeIds, [filters.monthKey])
    ]);

    for (const entry of reports) {
      // A DRAFT contributes to neither submitted count — it does not satisfy
      // the filing requirement, so counting it would overstate compliance
      // against the very ledger that warns for the same day.
      if (entry.status === 'SUBMITTED') add(entry.employeeId, 'submitted_on_time', entry.count);
      else if (entry.status === 'SUBMITTED_LATE') add(entry.employeeId, 'submitted_late', entry.count);
      if (entry.managerFiled && entry.status !== 'DRAFT') add(entry.employeeId, 'manager_filed', entry.count);
    }
    for (const entry of claims) {
      if (entry.status === 'PENDING') add(entry.employeeId, 'pending_leave', entry.count);
      else if (entry.status === 'APPROVED') add(entry.employeeId, 'approved_leave', entry.count);
    }
    for (const entry of warnings) {
      if (entry.status === 'ACTIVE') add(entry.employeeId, 'active_warnings', entry.count);
      else add(entry.employeeId, 'waived_warnings', entry.count);
    }
  }

  return {
    month_key: filters.monthKey,
    working_days: workingDays,
    totals: finalise(totals),
    by_department: [...byDepartment.values()].map(finalise).sort((a, b) => a.label.localeCompare(b.label)),
    // Worst compliance first — the point of an employee-wise list is to find
    // who needs a conversation, not to read the alphabet.
    by_employee: [...byEmployee.values()].map(finalise).sort((a, b) => a.compliance_percent - b.compliance_percent || a.label.localeCompare(b.label))
  };
}
