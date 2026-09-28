import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { isBackOfficeActor } from '@/lib/backOfficeAccess';
import BackOfficeView from '@/components/BackOfficeView';

export default async function BackOfficePage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const canManage = await isBackOfficeActor({ role: user.role, username: user.username });
  return <BackOfficeView canManage={canManage} />;
}
