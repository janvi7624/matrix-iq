import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { REPORT_VIEWER_USERNAME, REPORT_VIEWER_ROLES, REPORT_VIEWER_DEPARTMENT } from '@/lib/adminExpenseReportAccess';
import AdminExpenseReportView from '@/components/AdminExpenseReportView';

export default async function AdminExpenseReportPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  // Hardik Acharya by name, an admin/superadmin role, or the Administration
  // department — see lib/adminExpenseReportAccess.ts.
  const isAllowed =
    user.username === REPORT_VIEWER_USERNAME ||
    REPORT_VIEWER_ROLES.includes(session.role) ||
    user.department === REPORT_VIEWER_DEPARTMENT;
  if (!isAllowed) redirect('/');

  return <AdminExpenseReportView />;
}
