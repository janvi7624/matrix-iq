import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { canAccessHrExpenseModule } from '@/lib/hrExpenseAccess';
import AdminExpensesView from '@/components/AdminExpensesView';

export default async function AdminExpensesPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  // Super Admin + Admin + named individuals (lib/hrExpenseAccess.ts). Was a
  // local ['superadmin','admin','hr'] set, which gave every HR account the
  // register; the same rule now lives in one place and also gates the tile
  // and the API, so the three can't disagree.
  if (!canAccessHrExpenseModule('admin-expenses', { role: session.role, username: session.username })) redirect('/');

  return <AdminExpensesView currentUser={{ username: user.username }} />;
}
