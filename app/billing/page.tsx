import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import BillingView from '@/components/BillingView';

export default async function BillingPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  if (!(await isModuleAccessAllowed('billing', { role: user.role, isPrivileged }))) redirect('/');

  return <BillingView currentUser={{ username: user.username, role: user.role }} />;
}
