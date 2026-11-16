import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { isAppreciationDecider, canSubmitAppreciation } from '@/lib/appreciationAccess';
import HrAppreciationView from '@/components/HrAppreciationView';

// Not requireHrPage: that gate does not know about department heads who hold
// no 'manager' role. Access here is exactly the API's rule — the HR Manager /
// admins (decide), or anyone with a team to appreciate (submit).
export default async function HrAppreciationPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');
  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const viewer = { userId: user.id, username: user.username, role: user.role };
  const [isDecider, canSubmit] = await Promise.all([isAppreciationDecider(viewer), canSubmitAppreciation(viewer)]);
  if (!isDecider && !canSubmit) redirect('/');

  return <HrAppreciationView />;
}
