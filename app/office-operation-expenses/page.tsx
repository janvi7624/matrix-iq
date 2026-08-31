import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { roleCanAccessOfficeOperationExpenses } from '@/lib/officeOperationExpenseAccess';
import OfficeOperationExpensesView from '@/components/OfficeOperationExpensesView';

// HR + Admin + Super Admin only — same page-level shape as
// app/admin-expenses/page.tsx, with the allow-list shared with the API routes
// (lib/officeOperationExpenseAccess.ts) so the page gate and the data gate
// can't drift apart.
export default async function OfficeOperationExpensesPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  if (!roleCanAccessOfficeOperationExpenses(session.role)) redirect('/');

  // Passed through only so the Excel voucher can stamp "Prepared By" and the
  // department in its header block — same pattern as ReimbursementView.
  return <OfficeOperationExpensesView currentUser={{ name: user.name || user.username, department: user.department || '' }} />;
}
