import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './auth';
import { findUserById } from './userStore';
import { resolveIsPrivileged } from './permissions';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { UserRole } from './types';
import { departmentsManagedBy, isUserADepartmentManager } from './departmentStore';

export interface TeamTasksPageViewer {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  isPrivileged: boolean;
  isDepartmentManager: boolean;
  // Departments this exact viewer manages (empty for privileged viewers, who
  // get every department instead — see TeamTasksView's department picker).
  managedDepartments: { id: string; name: string }[];
}

// Server-component gate for app/team-tasks/page.tsx — mirrors
// lib/hrPageGuard.ts's requireHrPage, generalized: instead of one fixed HR
// department, resolves whichever department(s) THIS viewer actually manages.
export async function requireTeamTasksPage(): Promise<TeamTasksPageViewer> {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  const isDeptManager = await isUserADepartmentManager(user.username);

  if (!(await isModuleAccessAllowed('team-tasks', { role: user.role, isPrivileged, isDepartmentManager: isDeptManager }))) redirect('/');

  const managedDepartments = isPrivileged ? [] : await departmentsManagedBy(user.username);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    isPrivileged,
    isDepartmentManager: isDeptManager,
    managedDepartments
  };
}
