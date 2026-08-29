import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './auth';
import { findUserById, findUserNameAndDeptByUsername } from './userStore';
import { resolveIsPrivileged } from './permissions';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { UserRole } from './types';
import { TmsModuleKey } from './tmsAccess';

export interface TmsPageViewer {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  isPrivileged: boolean;
  department: string;
}

// Server-component gate for every app/tms/**/page.tsx — mirrors the
// cookies()+verifySessionToken()+findUserById() boilerplate already used by
// every other page (see app/projects/page.tsx), PLUS the department +
// module-access check no other route area in this app needed before now
// (everything else either sits behind proxy.ts's blanket /admin prefix or
// has no restriction beyond login). Redirects to '/' (not just hides a
// link) so a blocked department's user genuinely cannot reach the page by
// typing the URL — proxy.ts can't do this check itself since it must never
// import anything that touches Sequelize/pg (see proxy.ts's own comment).
export async function requireTmsPage(moduleKey: TmsModuleKey): Promise<TmsPageViewer> {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const [isPrivileged, deptInfo] = await Promise.all([resolveIsPrivileged(user.role), findUserNameAndDeptByUsername(user.username)]);
  const viewer: TmsPageViewer = { id: user.id, username: user.username, name: user.name, role: user.role, isPrivileged, department: deptInfo?.department ?? '' };

  if (!(await isModuleAccessAllowed(moduleKey, viewer))) redirect('/');
  return viewer;
}
