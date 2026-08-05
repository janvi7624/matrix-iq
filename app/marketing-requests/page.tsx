import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged, isModuleActionAllowed } from '@/lib/permissions';
import MarketingRequestsView from '@/components/MarketingRequestsView';

export default async function MarketingRequestsPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  const isReviewer = isPrivileged || (await isModuleActionAllowed({ role: user.role, isPrivileged }, 'marketing-requests', 'approve'));

  return <MarketingRequestsView currentUser={{ username: user.username, role: user.role }} isReviewer={isReviewer} />;
}
