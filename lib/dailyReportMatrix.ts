import { Op } from 'sequelize';
import { db } from './db';
import { ViewerContext } from './viewerContext';
import {
  TeamMatrixCell,
  TeamMatrixDayDetail,
  TeamMatrixEmployee,
  TeamMatrixExpansion,
  TeamMatrixResponse
} from './dailyReportTypes';
import { getDeadlinePolicy } from './dailyReportConfigStore';
import { resolveTemplateForDepartment } from './dailyReportTemplateStore';
import { loadReportStatuses, SUBMITTED_STATUSES } from './dailyReportStore';
import { loadClaimStatusKeys } from './dailyReportLeaveClaimStore';
import { loadWarningKeys } from './dailyReportWarningStore';
import { employeeOwesDate, listEligibleEmployees } from './dailyReportEligibility';
import { resolveDailyReportScope } from './dailyReportAccess';
import { addDays, istDate, workingDaysBetween } from './dailyReportTime';
import { DailyReportFieldDef, TemplateDefinition, computeDerivedValues } from './dailyReportTemplates';

// The team matrix: every employee a manager oversees as a ROW, every working
// day in a range as a COLUMN.
//
// The existing team dashboard (buildTeamDailyReports) answers "who filed
// today?" — one date, one row per person. That is the right shape for
// chasing a deadline and the wrong one for the question managers actually
// kept asking: "what has this person been doing?" Answering it meant opening
// one person, one day at a time, then going back and doing it again.
//
// Everything here reuses the single-date dashboard's own loaders — they
// already accept a date RANGE and were simply being called with the same
// date twice. No new access rule is introduced: scope still comes from
// resolveDailyReportScope, and a departmentId can only ever narrow it.

/** Range is capped so one request cannot ask for a year of a 200-person org. */
export const MAX_MATRIX_DAYS = 62;

export interface MatrixFilters {
  from?: string;
  to?: string;
  departmentId?: string;
  search?: string;
  /** Employee id whose per-day tasks to include. */
  expand?: string;
}

export class MatrixRangeError extends Error {}

function emptyCell(owed: boolean): TeamMatrixCell {
  return {
    status: 'MISSING',
    is_late: false,
    leave_status: '',
    warning_status: '',
    review_status: '',
    report_id: null,
    entry_count: 0,
    owed
  };
}

/**
 * Default range: the last two working weeks up to today.
 *
 * Chosen over "this calendar month" because a manager opening this on the
 * 1st would otherwise see one column. Ten working days always has something
 * in it.
 */
function defaultRange(): { from: string; to: string } {
  const to = istDate(new Date());
  return { from: addDays(to, -18), to };
}

export async function buildTeamMatrix(viewer: ViewerContext, filters: MatrixFilters = {}): Promise<TeamMatrixResponse> {
  const fallback = defaultRange();
  const from = filters.from || fallback.from;
  const to = filters.to || fallback.to;
  if (from > to) throw new MatrixRangeError('The start date must be on or before the end date.');

  const policy = await getDeadlinePolicy();
  const dates = workingDaysBetween(from, to, policy);
  if (dates.length > MAX_MATRIX_DAYS) {
    throw new MatrixRangeError(`Pick a shorter range — up to ${MAX_MATRIX_DAYS} working days at a time.`);
  }

  const scope = await resolveDailyReportScope(viewer);
  // A departmentId in the query may only ever NARROW the viewer's scope.
  // Passing someone else's id falls back to the viewer's own departments
  // rather than leaking theirs.
  const departmentIds =
    filters.departmentId && scope.departmentIds.includes(filters.departmentId) ? [filters.departmentId] : scope.departmentIds;

  const employees = departmentIds.length ? await listEligibleEmployees(departmentIds) : [];

  const search = (filters.search ?? '').trim().toLowerCase();
  const visible = search
    ? employees.filter((e) => `${e.name} ${e.username} ${e.departmentName}`.toLowerCase().includes(search))
    : employees;

  const employeeIds = visible.map((e) => e.id);
  const [statuses, claimsByDate, warningKeys] = await Promise.all([
    loadReportStatuses(employeeIds, from, to),
    loadClaimStatusKeys(employeeIds, from, to),
    loadWarningKeys(employeeIds, from, to)
  ]);

  const totals = { employees: visible.length, owed: 0, submitted: 0, submitted_late: 0, missing: 0, leave: 0 };

  const rows: TeamMatrixEmployee[] = visible.map((employee) => {
    const cells: Record<string, TeamMatrixCell> = {};
    const own = { owed: 0, submitted: 0, submitted_late: 0, missing: 0, leave: 0, entries: 0 };

    for (const date of dates) {
      const key = `${employee.id}|${date}`;
      // Whether this person owed THIS date — a weekly-off rota or an
      // exemption makes the square blank rather than red, which is the
      // difference between "nothing to do" and "did not do it".
      const owed = employeeOwesDate(employee, date);
      const cell = emptyCell(owed);

      const found = statuses.get(key);
      const submitted = !!found && SUBMITTED_STATUSES.includes(found.submission_status);
      if (submitted && found) {
        cell.status = found.submission_status;
        cell.is_late = found.is_late;
        cell.review_status = found.review_status;
        cell.report_id = found.id;
        cell.entry_count = found.entry_count;
      }
      cell.leave_status = claimsByDate.get(key) ?? '';
      cell.warning_status = warningKeys.has(key) ? 'ACTIVE' : '';
      cells[date] = cell;

      if (!owed) continue;
      own.owed++;
      own.entries += cell.entry_count;
      if (submitted) {
        own.submitted++;
        if (cell.status === 'SUBMITTED_LATE') own.submitted_late++;
      } else if (cell.leave_status) {
        own.leave++;
      } else {
        own.missing++;
      }
    }

    totals.owed += own.owed;
    totals.submitted += own.submitted;
    totals.submitted_late += own.submitted_late;
    totals.missing += own.missing;
    totals.leave += own.leave;

    return {
      employee_id: employee.id,
      employee_name: employee.name,
      employee_username: employee.username,
      department_id: employee.departmentId,
      department_name: employee.departmentName,
      template_key: employee.templateKey,
      cells,
      totals: own
    };
  });

  rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'en', { sensitivity: 'base' }));

  // Only ever for an employee already in `visible` — so the expansion cannot
  // be used to read someone outside the viewer's scope by passing their id.
  const target = filters.expand ? visible.find((e) => e.id === filters.expand) : undefined;
  const expansion = target ? await buildExpansion(target.id, target.name, target.departmentId, dates) : null;

  return {
    from,
    to,
    dates,
    employees: rows,
    departments: scope.departments.map((d) => ({ id: d.id, name: d.name })),
    totals,
    expansion
  };
}

/** Render one stored value as the string the sheet shows. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => displayValue(v)).filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return '';
  return String(value).trim();
}

/**
 * Which template fields become sheet columns.
 *
 * Row templates use their rowFields. Narrative and matrix templates have no
 * per-task rows at all, so their header fields stand in — otherwise those
 * departments would expand to an empty sheet and read as "filed nothing".
 */
function sheetColumns(template: TemplateDefinition): DailyReportFieldDef[] {
  if (template.layout === 'rows' && template.rowFields.length) return template.rowFields;
  return template.headerFields;
}

async function buildExpansion(
  employeeId: string,
  employeeName: string,
  departmentId: string,
  dates: string[]
): Promise<TeamMatrixExpansion> {
  const resolved = await resolveTemplateForDepartment(departmentId);
  const today = istDate(new Date());
  const columns = sheetColumns(resolved.template).map((f) => ({ key: f.key, label: f.label }));

  const reports = await db.DailyReport.findAll({
    where: {
      employee_id: employeeId,
      report_date: { [Op.between]: [dates[0] ?? '', dates[dates.length - 1] ?? ''] },
      // Drafts are excluded here exactly as they are in the dashboard: a
      // draft's contents stay private to its author until submitted.
      submission_status: SUBMITTED_STATUSES
    } as never,
    attributes: ['id', 'report_date', 'submission_status', 'is_late', 'submitted_at', 'payload'],
    include: [{ model: db.DailyReportEntry, as: 'entries', attributes: ['position', 'data'], required: false }] as never,
    order: [['report_date', 'ASC']]
  });

  const byDate = new Map<string, TeamMatrixDayDetail>();
  for (const report of reports) {
    const plain = report.get({ plain: true }) as Record<string, unknown>;
    const rawDate = plain.report_date;
    const date = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate).slice(0, 10);
    const rawEntries = (Array.isArray(plain.entries) ? plain.entries : []) as { position: number; data: Record<string, unknown> }[];

    const entries = [...rawEntries]
      .sort((a, b) => a.position - b.position)
      .map((entry, index) => {
        const data = entry.data ?? {};
        // Computed fields — Task ID above all — are generated, never stored,
        // so reading `data` alone leaves that column blank. Derived exactly
        // as the detail view derives it (toRecord in dailyReportStore.ts) so
        // the sheet shows the same Task ID the employee sees.
        const derived = computeDerivedValues(resolved.template, date, data, index, today);
        const flat: Record<string, string> = {};
        for (const column of columns) {
          const raw = data[column.key] ?? (derived as Record<string, unknown>)[column.key];
          flat[column.key] = displayValue(raw);
        }
        return flat;
      });

    const narrative: Record<string, string> = {};
    const payload = (plain.payload as Record<string, unknown>) ?? {};
    const headerDerived = computeDerivedValues(resolved.template, date, payload, 0, today);
    for (const column of columns) {
      const value = displayValue(payload[column.key] ?? (headerDerived as Record<string, unknown>)[column.key]);
      if (value) narrative[column.key] = value;
    }

    byDate.set(date, {
      report_date: date,
      report_id: plain.id as string,
      status: plain.submission_status as TeamMatrixDayDetail['status'],
      is_late: Boolean(plain.is_late),
      submitted_at: plain.submitted_at instanceof Date ? plain.submitted_at.toISOString() : String(plain.submitted_at ?? ''),
      leave_status: '',
      entries,
      narrative
    });
  }

  // Every date in the range appears, filed or not — a gap in the sheet is
  // the information, and omitting empty days would quietly close it up.
  const days: TeamMatrixDayDetail[] = dates.map(
    (date) =>
      byDate.get(date) ?? {
        report_date: date,
        report_id: null,
        status: 'MISSING',
        is_late: false,
        submitted_at: '',
        leave_status: '',
        entries: [],
        narrative: {}
      }
  );

  return { employee_id: employeeId, employee_name: employeeName, template_key: resolved.templateKey, columns, days };
}
