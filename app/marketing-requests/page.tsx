import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged, isMarketingManager } from '@/lib/permissions';
import MarketingRequestsView from '@/components/MarketingRequestsView';

export default async function MarketingRequestsPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  const isReviewer = await isMarketingManager({ username: user.username, role: user.role, isPrivileged });

  return <MarketingRequestsView currentUser={{ username: user.username, role: user.role }} isReviewer={isReviewer} />;
}
