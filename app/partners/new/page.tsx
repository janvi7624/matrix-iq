import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { canCreatePartner } from '@/lib/partnerAccess';
import { resolveIsPrivileged } from '@/lib/permissions';
import PartnerCreateView from '@/components/PartnerCreateView';

// Creating a partner. Gated on canCreatePartner — the named list plus
// everyone who could already manage partners — not on being an admin.
export default async function NewPartnerPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(session.role);
  const allowed = await canCreatePartner({
    userId: session.sub,
    username: session.username,
    role: session.role,
    isPrivileged
  });
  if (!allowed) redirect('/partners');

  return <PartnerCreateView />;
}
