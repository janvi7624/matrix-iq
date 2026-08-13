import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import AuditLogView from '@/components/AuditLogView';

// Audit Log is Super Admin only — everything else under /admin/* just needs
// proxy.ts's blanket privileged check, but this page is tightened further.
export default async function AuditLogPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user || user.role !== 'superadmin') redirect('/');

  return <AuditLogView />;
}
