import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { canSeePartnerWorkspace, resolvePartnerStakeholder } from '@/lib/partnerWorkspaceAccess';
import { resolveIsPrivileged } from '@/lib/permissions';
import PartnerWorkspaceView from '@/components/PartnerWorkspaceView';

// The Partner module's home.
//
// Gated on INVOLVEMENT, not role — whoever may create a partner, or is the
// creator/relationship manager of one. Same page-level shape as the other
// named-individual modules (app/office-operation-expenses/page.tsx), with
// the rule shared with /api/partners so the page gate and the data gate
// cannot drift apart.
export default async function PartnersPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const [isPrivileged, isPartnerStakeholder] = await Promise.all([
    resolveIsPrivileged(session.role),
    resolvePartnerStakeholder(session.sub)
  ]);
  if (!canSeePartnerWorkspace({ isPrivileged, isPartnerStakeholder })) redirect('/');

  return <PartnerWorkspaceView />;
}
