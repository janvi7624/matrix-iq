import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged, isMarketingManager } from '@/lib/permissions';
import MaterialsView from '@/components/MaterialsView';

// Readable by every signed-in user — the point of the module is that anyone
// can find a datasheet without Drive access. Adding, editing and removing are
// Marketing's alone, which is what `canManage` gates (and the API enforces
// independently, so a stale page can't write).
export default async function MaterialsPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  const canManage = await isMarketingManager({ username: user.username, role: user.role, isPrivileged });

  return <MaterialsView canManage={canManage} />;
}
