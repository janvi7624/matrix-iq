import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { canAccessHrExpenseModule } from '@/lib/hrExpenseAccess';
import AdminExpenseForm from '@/components/AdminExpenseForm';

// Same page-level gate as app/admin-expenses/page.tsx — Add Expense moved
// from a modal over the list to its own page, then redirects back to the
// register on save.
export default async function NewAdminExpensePage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  if (!canAccessHrExpenseModule('admin-expenses', { role: session.role, username: session.username })) redirect('/');

  return <AdminExpenseForm />;
}
