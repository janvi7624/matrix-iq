import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import NegotiationView from '@/components/NegotiationView';

export default async function NegotiationPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);

  return <NegotiationView currentUser={{ username: user.username, role: user.role, isPrivileged }} />;
}
