import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import AccountsPaymentsView from '@/components/AccountsPaymentsView';

// Mirrors lib/hrPageGuard.ts's requireHrPage — redirects to '/' (not just
// hides a nav link) so a viewer without the accounts-payments module can't
// reach the page by typing the URL directly.
export default async function AccountsPaymentsPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  const viewer = { role: user.role, isPrivileged };

  if (!(await isModuleAccessAllowed('accounts-payments', viewer))) redirect('/');

  return <AccountsPaymentsView currentUser={{ username: user.username, name: user.name, role: user.role, isPrivileged }} />;
}
