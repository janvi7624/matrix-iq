import { Op } from 'sequelize';
import { db } from './db';
import { ViewerContext } from './viewerContext';
import { resolveDailyReportScope } from './dailyReportAccess';
import { expandSubjects, listEligibleEmployees } from './dailyReportEligibility';
import { getDeadlinePolicy } from './dailyReportConfigStore';
import { workingDaysBetween } from './dailyReportTime';
import {
  DepartmentPeriodSummary,
  EmployeePeriodSummary,
  PeriodLeave,
  PeriodReport,
  PeriodTotals,
  rollUp,
  summarisePeriodByDepartment,
  summarisePeriodByEmployee,
  worstFirst
} from './dailyReportPeriodSummary';

// Daily Report compliance over a date RANGE, for the month/quarter/year/custom
// filters, the department PDF, and the monthly summary mail.
//
// A separate file from lib/dailyReportStore.ts deliberately: that store already
// has range loaders, but they return Sets of "employeeId|date" keys which
// collapse exactly the distinctions this needs — loadSubmittedKeys does not
// separate SUBMITTED from SUBMITTED_LATE, and loadLeaveCoveredKeys includes
// PENDING claims alongside APPROVED ones. Reusing them would mean reporting a
// late report as on time and letting an unapproved leave claim excuse a missing
// one. The two loaders below are the same queries without that flattening.
//
// The fold itself is in lib/dailyReportPeriodSummary.ts (pure, 21 tests). The
// obligations come from expandSubjects — the same helper the sweep uses — so
// these figures agree with the sweep's by construction rather than by luck.

function dateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Reports in range, keeping on-time and late apart. */
export async function loadPeriodReports(employeeIds: string[], from: string, to: string): Promise<PeriodReport[]> {
  if (!employeeIds.length) return [];
  const rows = await db.DailyReport.findAll({
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } } as never,
    attributes: ['employee_id', 'report_date', 'submission_status']
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      employeeId: String(plain.employee_id),
      reportDate: dateOnly(plain.report_date),
      submissionStatus: String(plain.submission_status) as PeriodReport['submissionStatus']
    };
  });
}

/**
 * Leave claims in range, with their status intact.
 *
 * Every status is returned, not just the live ones: the fold decides what
 * excuses a day (only APPROVED), and handing it a pre-filtered list would move
 * that decision somewhere it cannot be tested.
 */
export async function loadPeriodLeave(employeeIds: string[], from: string, to: string): Promise<PeriodLeave[]> {
  if (!employeeIds.length) return [];
  const rows = await db.DailyReportLeaveClaim.findAll({
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } } as never,
    attributes: ['employee_id', 'report_date', 'status']
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      employeeId: String(plain.employee_id),
      reportDate: dateOnly(plain.report_date),
      status: String(plain.status)
    };
  });
}

export interface PeriodFilters {
  from: string;
  to: string;
  departmentId?: string;
  /** Matches an employee's name or username, case-insensitively. */
  search?: string;
}

export interface PeriodEmployeeRow extends EmployeePeriodSummary {
  name: string;
  username: string;
  departmentId: string;
  departmentName: string;
}

export interface PeriodSummaryResponse {
  from: string;
  to: string;
  /** Working days in the range, per the configured working-day policy. */
  workingDays: number;
  employees: PeriodEmployeeRow[];
  departments: DepartmentPeriodSummary[];
  /** Worst-first, for a manager who wants the problems not the list. */
  attention: DepartmentPeriodSummary[];
  totals: PeriodTotals;
  /** Departments the viewer may filter by — their scope, not every one. */
  departmentOptions: { id: string; name: string }[];
}

export async function getPeriodSummary(viewer: ViewerContext, filters: PeriodFilters): Promise<PeriodSummaryResponse> {
  const [policy, scope] = await Promise.all([getDeadlinePolicy(), resolveDailyReportScope(viewer)]);

  // Narrowing to one department is only ever allowed WITHIN the viewer's own
  // scope — a department id in the query string cannot widen it. Same rule as
  // buildTeamDailyReports.
  const departmentIds =
    filters.departmentId && scope.departmentIds.includes(filters.departmentId)
      ? [filters.departmentId]
      : scope.departmentIds;

  const employees = departmentIds.length ? await listEligibleEmployees(departmentIds) : [];

  // Only working days carry an obligation. A range spanning a month of
  // Sundays would otherwise report everybody as massively non-compliant.
  const reportDates = workingDaysBetween(filters.from, filters.to, policy);
  const subjects = expandSubjects(employees, reportDates);

  const employeeIds = employees.map((e) => e.id);
  const [reports, leave] = await Promise.all([
    loadPeriodReports(employeeIds, filters.from, filters.to),
    loadPeriodLeave(employeeIds, filters.from, filters.to)
  ]);

  // `now` is what keeps a day that has not reached its own deadline yet out
  // of "missing" — see summarisePeriodByEmployee's own comment. Without it,
  // picking "This Month" while the month is still in progress (the normal
  // case, every month until its last day) reported every remaining working
  // day as owed and unfiled before anyone could have filed them.
  const byEmployee = summarisePeriodByEmployee(subjects, reports, leave, new Date());
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const q = (filters.search ?? '').trim().toLowerCase();
  const rows: PeriodEmployeeRow[] = byEmployee
    .map((row) => {
      const employee = employeeById.get(row.employeeId);
      return {
        ...row,
        name: employee?.name ?? '',
        username: employee?.username ?? '',
        departmentId: employee?.departmentId ?? '',
        departmentName: employee?.departmentName ?? ''
      };
    })
    // Search is applied AFTER the fold so narrowing to one person cannot
    // change anybody else's figures.
    .filter((row) => !q || `${row.name} ${row.username}`.toLowerCase().includes(q))
    // Worst compliance first: the point of the screen is who has not filed.
    // Nulls (nothing expected) sort last — they are not a problem.
    .sort((a, b) => (a.filedPercent ?? 101) - (b.filedPercent ?? 101) || b.missing - a.missing);

  const departments = summarisePeriodByDepartment(rows, (employeeId) => {
    const employee = employeeById.get(employeeId);
    if (!employee?.departmentId) return null;
    return { id: employee.departmentId, name: employee.departmentName ?? '' };
  });

  return {
    from: filters.from,
    to: filters.to,
    workingDays: reportDates.length,
    employees: rows,
    departments,
    attention: worstFirst(departments),
    totals: rollUp(rows),
    departmentOptions: scope.departments ?? []
  };
}
