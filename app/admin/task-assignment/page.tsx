import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import AdminTaskAssignmentView from '@/components/AdminTaskAssignmentView';

export default async function AdminTaskAssignmentPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  if (!(await isModuleAccessAllowed('admin-task-assignment', { role: user.role, isPrivileged }))) redirect('/');

  return <AdminTaskAssignmentView currentUser={{ username: user.username, name: user.name, role: user.role }} />;
}
