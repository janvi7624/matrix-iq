import { QueryTypes } from 'sequelize';
import { sequelize } from './db';
import { listTemplateAssignments } from './dailyReportTemplateStore';
import { DailyReportTemplateKey } from './dailyReportTemplates';

// Who owes a daily report, and who deliberately does not.
//
// This is the single answer the employee page, the manager dashboard, the
// scheduler and analytics all use. It has to be one function: if the
// "expected" set the scheduler warns against were ever a different set from
// the one the dashboard counts, the compliance percentage and the warning
// ledger would disagree, and the warning ledger is the one that emails
// people.
//
// Three exclusions, each for a stated reason:
//   1. Inactive accounts. status != 'active' means they have left or are
//      suspended (see UserStatus in lib/types.ts) — nothing is expected and
//      nothing is warned.
//   2. Departments whose template is 'not_configured'. Accounts ships this
//      way pending an approved format, and Administration / Back Office
//      until an admin assigns one. The brief is explicit that these staff
//      must be excluded from reminders and warnings, not merely shown an
//      empty form.
//   3. Accounts with no department at all — notably superadmin accounts,
//      which carry no department (see the comment on ACCOUNTS_MODULE_ROLES
//      in lib/moduleConfigStore.ts). There is no format to file.

export interface EligibleEmployee {
  id: string;
  username: string;
  name: string;
  email: string;
  departmentId: string;
  departmentName: string;
  templateKey: DailyReportTemplateKey;
  /** DATEONLY 'YYYY-MM-DD', or '' — see the dateOfJoining note below. */
  dateOfJoining: string;
}

interface EmployeeRow {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  department_id: string | null;
  date_of_joining: string | null;
}

/**
 * Every active employee in a department whose template is configured.
 *
 * `departmentIds` narrows it to a manager's own scope; omitted means every
 * eligible employee (the scheduler, and an org-wide viewer).
 */
export async function listEligibleEmployees(departmentIds?: string[]): Promise<EligibleEmployee[]> {
  const assignments = await listTemplateAssignments();
  const configured = assignments.filter((a) => a.status === 'active' && a.templateKey !== 'not_configured');
  if (!configured.length) return [];

  const allowed = departmentIds && departmentIds.length ? configured.filter((a) => departmentIds.includes(a.departmentId)) : configured;
  if (!allowed.length) return [];

  const byId = new Map(allowed.map((a) => [a.departmentId, a]));

  // Raw SQL rather than db.User.findAll because the users table is
  // `underscored: false` for most columns but the migration-added
  // departmentId/dateOfJoining are mixed-case in the model and snake_case in
  // the database; one explicit projection is clearer than fighting that, and
  // this is the query the scheduler runs once per sweep.
  const rows = await sequelize.query<EmployeeRow>(
    `SELECT u.id, u.username, u.name, u.email, u."departmentId" AS department_id, u."dateOfJoining" AS date_of_joining
       FROM users u
      WHERE u."deletedAt" IS NULL
        AND u.status = 'active'
        AND u."departmentId" = ANY($departmentIds)
      ORDER BY u.name NULLS LAST, u.username`,
    { bind: { departmentIds: [...byId.keys()] }, type: QueryTypes.SELECT }
  );

  return rows.map((row) => {
    const assignment = byId.get(row.department_id as string);
    return {
      id: row.id,
      username: row.username,
      name: row.name || row.username,
      email: row.email || '',
      departmentId: row.department_id as string,
      departmentName: assignment?.departmentName ?? '',
      templateKey: (assignment?.templateKey ?? 'not_configured') as DailyReportTemplateKey,
      dateOfJoining: row.date_of_joining ? String(row.date_of_joining).slice(0, 10) : ''
    };
  });
}

/**
 * Whether a specific reporting date is in scope for one employee.
 *
 * Only ever narrower than listEligibleEmployees, never wider. The
 * joining-date check is the reason this exists separately: without it, the
 * first sweep after launch would warn a new joiner for every working day
 * before their start date, which is both wrong and the kind of thing that
 * destroys trust in a compliance tool on day one.
 */
export function employeeOwesDate(employee: EligibleEmployee, reportDate: string): boolean {
  if (!employee.dateOfJoining) return true;
  return reportDate >= employee.dateOfJoining;
}

/** The subject list a sweep plans against: every eligible employee × date. */
export function expandSubjects(employees: EligibleEmployee[], reportDates: string[]): { employeeId: string; reportDate: string }[] {
  const subjects: { employeeId: string; reportDate: string }[] = [];
  for (const employee of employees) {
    for (const reportDate of reportDates) {
      if (!employeeOwesDate(employee, reportDate)) continue;
      subjects.push({ employeeId: employee.id, reportDate });
    }
  }
  return subjects;
}
