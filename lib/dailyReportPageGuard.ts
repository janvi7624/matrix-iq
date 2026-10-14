import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './auth';
import { findUserById } from './userStore';
import { resolveIsPrivileged } from './permissions';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { isUserADepartmentManager } from './departmentStore';
import { isHrManager } from './hrAccess';
import { findRoleByKey } from './roleStore';
import { UserRole } from './types';

// Server-component gates for the module's four pages.
//
// Mirrors lib/hrPageGuard.ts and lib/teamTasksPageGuard.ts, including the
// redirect-to-'/' rather than rendering an "access denied" screen: an
// unauthorized viewer genuinely cannot reach the page by typing its URL, and
// bouncing them is the behaviour the rest of the app already has.
//
// These guards are a UX convenience, not the security boundary. Every API
// route performs its own check (see lib/dailyReportApi.ts and
// lib/dailyReportAccess.ts) — a page guard alone would be bypassed by anyone
// calling the endpoints directly.

export interface DailyReportPageViewer {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  isPrivileged: boolean;
  isDepartmentManager: boolean;
  /**
   * Whether the merged Daily Report page should offer its Team tab.
   *
   * Resolved here, on the server, from the same 'team-daily-reports' module
   * gate the team API enforces — so the tab cannot appear for someone the
   * endpoints behind it would refuse. Only ever populated by
   * requireDailyReportPage; false elsewhere.
   */
  canViewTeam: boolean;
}

async function resolveViewer(): Promise<DailyReportPageViewer> {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const [isPrivileged, isDepartmentManager] = await Promise.all([resolveIsPrivileged(user.role), isUserADepartmentManager(user.username)]);
  return { id: user.id, username: user.username, name: user.name, role: user.role, isPrivileged, isDepartmentManager, canViewTeam: false };
}

/**
 * The merged Daily Report page — every authenticated role gets their own
 * report; `canViewTeam` decides whether the Team tab is offered.
 *
 * The team check is the full one, not a shortcut: the 'team-daily-reports'
 * module must be enabled and visible (it is MANAGER_GATED_KEYS, so
 * isModuleAccessAllowed already requires isPrivileged or real
 * department-manager membership), AND the viewer must genuinely manage a
 * department. The second clause is belt-and-braces for the case where an
 * admin removes the key from MANAGER_GATED_KEYS in a future edit, which
 * would otherwise widen the tab to every role in its visibleToRoles list.
 */
export async function requireDailyReportPage(): Promise<DailyReportPageViewer> {
  const viewer = await resolveViewer();
  if (!(await isModuleAccessAllowed('daily-report', viewer))) redirect('/');
  const canViewTeam =
    (viewer.isPrivileged || viewer.isDepartmentManager) && (await isModuleAccessAllowed('team-daily-reports', viewer));
  return { ...viewer, canViewTeam };
}

/** HR review — HR managers and administrators. */
export async function requireHrDailyReportsPage(): Promise<DailyReportPageViewer> {
  const viewer = await resolveViewer();
  if (!(await isModuleAccessAllowed('hr-daily-reports', viewer))) redirect('/');
  if (!(await isHrManager(viewer))) redirect('/');
  return viewer;
}

/**
 * Daily Report Configuration — Admin/Super Admin, or a role with an explicit
 * `manage` grant on this module.
 *
 * Mirrors canAccessDailyReportConfig in lib/dailyReportAccess.ts exactly,
 * including deliberately NOT using isModuleActionAllowed (whose no-override
 * fallback is isPrivileged, which every department manager satisfies). The
 * two must agree, or the page would render for someone its own API refuses.
 */
export async function requireDailyReportConfigPage(): Promise<DailyReportPageViewer> {
  const viewer = await resolveViewer();
  if (!(await isModuleAccessAllowed('daily-report-config', viewer))) redirect('/');
  if (viewer.role === 'admin' || viewer.role === 'superadmin') return viewer;
  const record = await findRoleByKey(viewer.role);
  if (record?.status === 'active' && record.permissions.modules['daily-report-config']?.manage === true) return viewer;
  redirect('/');
}
