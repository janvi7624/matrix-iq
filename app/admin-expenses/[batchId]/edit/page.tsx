import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { canAccessHrExpenseModule } from '@/lib/hrExpenseAccess';
import AdminExpenseForm from '@/components/AdminExpenseForm';

// Same page-level gate as app/admin-expenses/page.tsx. The batch itself is
// loaded client-side by batchId (see AdminExpenseForm), the same way the API
// already groups entries, rather than here.
export default async function EditAdminExpensePage({ params }: { params: Promise<{ batchId: string }> }) {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  if (!canAccessHrExpenseModule('admin-expenses', { role: session.role, username: session.username })) redirect('/');

  const { batchId } = await params;
  return <AdminExpenseForm editBatchId={batchId} />;
}
