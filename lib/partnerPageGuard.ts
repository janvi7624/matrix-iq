import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './auth';
import { findUserStatusById } from './userStore';
import { findPartnerById, isPartnerUsable } from './partnerStore';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { PartnerRecord, UserRole } from './types';

export interface PartnerPageViewer {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  partnerId: string;
  partner: PartnerRecord;
}

/**
 * Server-component gate for every app/partner/**\/page.tsx — the partner-side
 * counterpart to lib/tmsPageGuard.ts's requireTmsPage, and built the same way
 * for the same reason: proxy.ts gates the /partner route AREA from a token
 * claim, but it must never import anything that touches Sequelize (see the
 * comment at the top of proxy.ts), so the live checks — is the account still
 * bound to a partner, is that partner still usable, is this module even
 * enabled — have to happen inside a real server component.
 *
 * Redirects rather than rendering an error: a partner whose company was just
 * suspended should land on the login screen, not on a portal page explaining
 * internal state to them.
 */
export async function requirePartnerPage(moduleKey?: string): Promise<PartnerPageViewer> {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserStatusById(session.sub);
  if (!user || user.status === 'inactive') redirect('/login');
  // An internal account reaching a portal page means proxy.ts let it through
  // — send it home rather than rendering a partner screen with no partner.
  if (!user.partnerId) redirect('/');

  const partner = await findPartnerById(user.partnerId);
  if (!partner || !isPartnerUsable(partner.status)) redirect('/login');

  const viewer: PartnerPageViewer = {
    id: user.id,
    username: session.username,
    name: user.name || session.username,
    role: session.role,
    partnerId: user.partnerId,
    partner
  };

  // Module Manager can switch any portal tile off; honour that here so a
  // disabled module is genuinely unreachable and not merely unlinked.
  // partnerId is passed through so the partner-keys branch in
  // isModuleAccessAllowed can recognise this viewer.
  if (moduleKey) {
    const allowed = await isModuleAccessAllowed(moduleKey, {
      role: viewer.role,
      isPrivileged: false,
      partnerId: viewer.partnerId
    });
    if (!allowed) redirect('/partner');
  }

  return viewer;
}
