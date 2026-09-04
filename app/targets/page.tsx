import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import { canManageTargets } from '@/lib/targetAccess';
import TargetDetailsView from '@/components/TargetDetailsView';

// Manager-only (Sales/GEM-Sales department managers, or any org-wide
// viewer) — canManageTargets is the single source of truth, reused
// identically by every /api/targets/* route so the page gate and the data
// gate can never drift apart.
export default async function TargetsPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(session.role);
  if (!(await canManageTargets({ username: user.username, role: session.role, isPrivileged }))) redirect('/');

  return <TargetDetailsView />;
}
