import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import AdminExpensesView from '@/components/AdminExpensesView';

const ALLOWED_ROLES = new Set(['superadmin', 'admin']);

export default async function AdminExpensesPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  if (!ALLOWED_ROLES.has(session.role)) redirect('/');

  return <AdminExpensesView />;
}
