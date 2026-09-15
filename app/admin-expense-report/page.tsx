import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { REPORT_VIEWER_USERNAME } from '@/lib/adminExpenseReportAccess';
import AdminExpenseReportView from '@/components/AdminExpenseReportView';

export default async function AdminExpenseReportPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  // Restricted to exactly one named person — see
  // lib/adminExpenseReportAccess.ts for why this isn't a role check.
  if (user.username !== REPORT_VIEWER_USERNAME) redirect('/');

  return <AdminExpenseReportView />;
}
