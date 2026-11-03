import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import MySoldProjectsView from '@/components/MySoldProjectsView';

export default async function MySoldProjectsPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  if (!(await isModuleAccessAllowed('my-sold-projects', { role: user.role, isPrivileged }))) redirect('/');

  return <MySoldProjectsView currentUser={{ name: user.name || user.username }} />;
}
