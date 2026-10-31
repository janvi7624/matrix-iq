import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { roleCanAccessOfficeOperationExpenses } from '@/lib/officeOperationExpenseAccess';
import OfficeOperationExpenseForm from '@/components/OfficeOperationExpenseForm';

// Same page-level gate as app/office-operation-expenses/page.tsx — Add
// Expense moved from a modal over the list to its own page so it has a real
// URL, then redirects back to the register on save.
export default async function NewOfficeOperationExpensePage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  if (!roleCanAccessOfficeOperationExpenses(session.role, session.username)) redirect('/');

  return <OfficeOperationExpenseForm />;
}
