import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { roleCanAccessOfficeOperationExpenses } from '@/lib/officeOperationExpenseAccess';
import OfficeOperationExpenseForm from '@/components/OfficeOperationExpenseForm';

// Same page-level gate as app/office-operation-expenses/page.tsx. The record
// itself is loaded client-side by id (see OfficeOperationExpenseForm) rather
// than here, since it also needs the options payload before it can be
// re-opened correctly (see buildFormFromRecord).
export default async function EditOfficeOperationExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  if (!roleCanAccessOfficeOperationExpenses(session.role, session.username)) redirect('/');

  const { id } = await params;
  return <OfficeOperationExpenseForm editId={id} />;
}
