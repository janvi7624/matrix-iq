import { use } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { canSeePartnerWorkspace, resolvePartnerStakeholder } from '@/lib/partnerWorkspaceAccess';
import { resolveIsPrivileged } from '@/lib/permissions';
import PartnerDetailView from '@/components/PartnerDetailView';

// One partner, inside the Partner module — the route a salesperson uses.
//
// Gated on involvement, same as /partners itself. Whether THIS viewer may
// act on THIS partner is decided by the APIs the screen calls
// (canReviewPartnerDocuments), not here: the page gate only answers "do you
// belong in the Partner module at all".
export default async function PartnerWorkspaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const [isPrivileged, isPartnerStakeholder] = await Promise.all([
    resolveIsPrivileged(session.role),
    resolvePartnerStakeholder(session.sub)
  ]);
  if (!canSeePartnerWorkspace({ isPrivileged, isPartnerStakeholder })) redirect('/');

  const { id } = await params;
  return <PartnerDetailView id={id} />;
}
