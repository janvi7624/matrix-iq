import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './auth';
import { findUserById } from './userStore';
import { resolveIsPrivileged } from './permissions';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { UserRole } from './types';
import { HrModuleKey, isHrManager } from './hrAccess';

export interface HrPageViewer {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  isPrivileged: boolean;
  isHrManager: boolean;
}

// Server-component gate for every app/hr/**/page.tsx — mirrors
// lib/tmsPageGuard.ts's requireTmsPage exactly, redirecting to '/' (not just
// hiding a nav link) so an unauthorized viewer genuinely can't reach the
// page by typing the URL.
export async function requireHrPage(moduleKey: HrModuleKey): Promise<HrPageViewer> {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  const viewer = { id: user.id, username: user.username, name: user.name, role: user.role, isPrivileged };

  if (!(await isModuleAccessAllowed(moduleKey, viewer))) redirect('/');
  const managerFlag = await isHrManager(viewer);
  return { ...viewer, isHrManager: managerFlag };
}
