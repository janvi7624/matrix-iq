import { ViewerContext } from './viewerContext';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { hasCapability } from './permissions';
import { findRoleByKey } from './roleStore';
import { departmentsManagedBy, findHrManagers, listDepartmentManagers } from './departmentStore';
import { isHrManager } from './hrAccess';
import { db } from './db';

// Who may see and do what in the Daily Report module.
//
// Every rule here resolves through structures the app already has, rather
// than introducing a parallel permission system:
//
//   * Module visibility and page/API access  -> Module Manager
//     (isModuleAccessAllowed), exactly like every other module.
//   * "Manager of a team"                    -> Department.managerIds via
//     Department Master, the same definition demo approvals, Team Tasks and
//     reimbursement routing already use. Not a role: a department's manager
//     can hold any role at all (see the MANAGER_GATED_KEYS comment in
//     lib/moduleConfigStore.ts).
//   * "HR"                                   -> lib/hrAccess.ts's isHrManager,
//     i.e. whoever manages the department matching /^hr\b/i. Same definition
//     Reimbursement's HR decisions use, so the two can't drift.
//   * "Sees everything"                      -> the viewAllDepartments
//     capability, with isPrivileged as the fallback tier — the same pair
//     lib/departmentScope.ts uses.
//
// Everything is enforced on the server. The pages do their own checks too,
// but only so an unauthorized person gets a redirect instead of a broken
// screen; the API checks are the actual control.

export const DAILY_REPORT_MODULE_KEYS = ['daily-report', 'team-daily-reports', 'hr-daily-reports', 'daily-report-config'] as const;
export type DailyReportModuleKey = (typeof DAILY_REPORT_MODULE_KEYS)[number];

export interface DailyReportScope {
  /** No department filtering needed — this viewer sees every employee. */
  seesOrgWide: boolean;
  /** Departments this viewer may READ. Empty + !seesOrgWide = own records only. */
  departmentIds: string[];
  /**
   * Departments this viewer may ACT on — edit a report, or file one on an
   * employee's behalf.
   *
   * Identical to departmentIds for everyone today, now that HR's old
   * company-wide read has been removed and nobody reads more than they
   * manage.
   *
   * Kept as a separate field rather than collapsed into one, because the
   * distinction is the thing that stops a future "let X see more" change from
   * silently also granting X edit-and-file rights over what it can now see —
   * which is exactly what happened when HR was widened. Widen departmentIds;
   * leave this one alone.
   */
  manageDepartmentIds: string[];
  departments: { id: string; name: string }[];
  /** Whether "File for Them" is available to this viewer. */
  canFileForOthers: boolean;
  isHr: boolean;
}

/**
 * What this viewer may see in the TEAM dashboard.
 *
 * A plain employee gets an empty scope and no org-wide flag, which every
 * caller treats as "your own records only" — they can still reach their own
 * Daily Report page, they just have no team to look at.
 */
export async function resolveDailyReportScope(viewer: ViewerContext): Promise<DailyReportScope> {
  const [orgWide, managed, hr] = await Promise.all([
    hasCapability(viewer.role, 'viewAllDepartments'),
    departmentsManagedBy(viewer.username),
    isHrManager(viewer)
  ]);

  // Admin and superadmin only.
  //
  // This used to fall back to `viewer.isPrivileged`, which is ALSO true for
  // the manager role (lib/permissions.ts:10) — so every department manager
  // silently read every department's daily reports, which is the opposite of
  // what a team dashboard is for. A manager now gets exactly the departments
  // they manage, from departmentsManagedBy below.
  //
  // The capability check stays first so an admin-created role explicitly
  // granted viewAllDepartments still works; the role test is the floor that
  // keeps the two built-in admin tiers working even if that capability is
  // ever cleared from the matrix. Same predicate as
  // canReviewDailyReportWarnings further down this file.
  //
  // HR is unaffected: its company-wide READ access is granted separately
  // below, deliberately, and without the manage/file rights this flag carries.
  const seesOrgWide = orgWide || viewer.role === 'admin' || viewer.role === 'superadmin';

  if (seesOrgWide) {
    const departments = await listActiveDepartments();
    const ids = departments.map((d) => d.id);
    return { seesOrgWide: true, departmentIds: ids, manageDepartmentIds: ids, departments, canFileForOthers: true, isHr: hr };
  }

  // HR gets no special reach here. It used to read every department's
  // reports; that was removed deliberately — the rule is that a manager sees
  // the departments they manage and only an admin sees all of them, and HR is
  // a department manager like any other.
  //
  // HR's actual compliance job is unaffected, because it never ran through
  // this function: the warnings queue, leave claims and waiving are gated by
  // canAccessHrReview further down, which is granted separately and stays
  // company-wide. So an HR manager still sees who has missed reports
  // everywhere and can still act on it — they just cannot open the CONTENTS
  // of another department's report, which is the manager's business.
  return {
    seesOrgWide: false,
    departmentIds: managed.map((d) => d.id),
    manageDepartmentIds: managed.map((d) => d.id),
    departments: managed,
    // Filing on someone's behalf is a manager action; a team member with no
    // managed department can never do it, whatever the module matrix says.
    canFileForOthers: managed.length > 0,
    isHr: hr
  };
}

async function listActiveDepartments(): Promise<{ id: string; name: string }[]> {
  const all = await db.Department.findAll({ where: { status: 'active' } as never, attributes: ['id', 'name'], order: [['order', 'ASC']] });
  return all.map((d) => ({ id: d.get('id') as string, name: d.get('name') as string }));
}

/** Can this viewer open the team dashboard at all? */
export async function canAccessTeamDashboard(viewer: ViewerContext): Promise<boolean> {
  const scope = await resolveDailyReportScope(viewer);
  if (!scope.seesOrgWide && !scope.departmentIds.length) return false;
  return isModuleAccessAllowed('team-daily-reports', { ...viewer, isDepartmentManager: scope.departmentIds.length > 0 });
}

/** Can this viewer open the HR review screens? */
export async function canAccessHrReview(viewer: ViewerContext): Promise<boolean> {
  if (!(await isModuleAccessAllowed('hr-daily-reports', viewer))) return false;
  // The module key is HR-restricted in Module Manager (HR + Admin + Super
  // Admin), and this adds the department-manager relationship on top, so an
  // 'hr'-role account that isn't actually an HR manager still can't decide
  // other people's leave claims.
  return isHrManager(viewer);
}

/**
 * Can this viewer change templates, deadlines and the scheduler?
 *
 * Narrower than the generic isPrivileged tier on purpose: this page arms a
 * job that emails the whole company and decides who gets warned, and
 * isPrivileged is true for every department 'manager' account. That is the
 * same reason app/api/admin/project-detail-reminders narrows its send to
 * admin/superadmin on top of the proxy's gate.
 *
 * The escape hatch for an admin-created role is an EXPLICIT `manage: true`
 * on this module in Role Management — deliberately not
 * isModuleActionAllowed(), whose documented fallback when no override is
 * configured is viewer.isPrivileged, which would quietly hand this page to
 * every manager in the company.
 */
export async function canAccessDailyReportConfig(viewer: ViewerContext): Promise<boolean> {
  if (!(await isModuleAccessAllowed('daily-report-config', viewer))) return false;
  if (viewer.role === 'admin' || viewer.role === 'superadmin') return true;
  const record = await findRoleByKey(viewer.role);
  if (!record || record.status !== 'active') return false;
  return record.permissions.modules['daily-report-config']?.manage === true;
}

export interface EmployeeAccess {
  canView: boolean;
  canEdit: boolean;
  canFileForThem: boolean;
  isSelf: boolean;
}

/**
 * What this viewer may do with ONE employee's reports.
 *
 * Resolved per employee rather than per department because that is the real
 * question at the point of use ("may you open Priya's Tuesday?"), and
 * because answering it from the employee's CURRENT department is what keeps
 * a transfer from silently handing their history to the wrong manager.
 */
export async function resolveEmployeeAccess(viewer: ViewerContext, employeeId: string): Promise<EmployeeAccess> {
  if (employeeId === viewer.userId) {
    return { canView: true, canEdit: true, canFileForThem: false, isSelf: true };
  }
  const scope = await resolveDailyReportScope(viewer);
  if (scope.seesOrgWide) {
    return { canView: true, canEdit: true, canFileForThem: true, isSelf: false };
  }
  if (!scope.departmentIds.length) {
    return { canView: false, canEdit: false, canFileForThem: false, isSelf: false };
  }
  const employee = await db.User.findByPk(employeeId, { attributes: ['id', 'departmentId'] });
  if (!employee) return { canView: false, canEdit: false, canFileForThem: false, isSelf: false };
  const department = employee.get('departmentId') as string;
  // Two different questions, two different lists. HR may read a report from
  // any department while being able to change one only in their own.
  const canView = scope.departmentIds.includes(department);
  const canManage = scope.manageDepartmentIds.includes(department);
  return { canView, canEdit: canManage, canFileForThem: canManage, isSelf: false };
}

export interface NotificationRecipient {
  id: string;
  username: string;
  name: string;
  /** '' when the account has no address on file — the bell still reaches them. */
  email: string;
}

// listDepartmentManagers() returns {id, username, name} and nothing else, so
// email addresses are resolved in one extra query here. Kept in this file
// rather than widening that shared store, because every other consumer of it
// (sidebar badges, approval routing, pickers) only needs the name and would
// pay for a column it never reads.
async function withEmails(people: { id: string; username: string; name: string }[]): Promise<NotificationRecipient[]> {
  if (!people.length) return [];
  const rows = await db.User.findAll({ where: { id: people.map((p) => p.id) } as never, attributes: ['id', 'email'] });
  const emailById = new Map(rows.map((r) => [r.get('id') as string, (r.get('email') as string) || '']));
  return people.map((p) => ({ ...p, email: emailById.get(p.id) ?? '' }));
}

/**
 * Who is told when a report is submitted: the employee's department
 * managers, plus any extra recipients configured for that department's
 * template. Resolved from Department Master rather than a stored list, so a
 * change of manager takes effect without re-saving anything here.
 */
export async function resolveReportManagers(departmentName: string, extraManagerIds: string[]): Promise<NotificationRecipient[]> {
  const byDepartment = await listDepartmentManagers();
  const managers = [...(byDepartment[departmentName] || [])];
  if (extraManagerIds.length) {
    const extra = await db.User.findAll({ where: { id: extraManagerIds, status: 'active' } as never, attributes: ['id', 'username', 'name'] });
    for (const row of extra) {
      const id = row.get('id') as string;
      if (managers.some((m) => m.id === id)) continue;
      managers.push({ id, username: row.get('username') as string, name: row.get('name') as string });
    }
  }
  return withEmails(managers);
}

/** Who receives HR escalations. Empty is a real, reportable misconfiguration. */
export async function resolveHrRecipients(): Promise<NotificationRecipient[]> {
  return withEmails(findHrManagers(await listDepartmentManagers()));
}
