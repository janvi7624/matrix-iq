import { NextRequest } from 'next/server';
import { UserRole } from './types';
import { getViewerContext } from './viewerContext';
import { findPartnerById, isPartnerUsable } from './partnerStore';
import { PartnerRecord } from './types';

export interface PartnerViewer {
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  partnerId: string;
  partner: PartnerRecord;
}

/**
 * The viewer resolution every `/api/partner/**` route starts with — the
 * partner-side counterpart to getViewerContext(), and the mirror image of
 * its deny-by-default rule: this one refuses INTERNAL accounts.
 *
 * Returning null for internal staff is deliberate and is not a convenience.
 * If staff could resolve here, every partner route would need a second
 * authorization path answering "which partner is this employee acting as",
 * and that question has no safe default. Staff manage partners through the
 * internal screens instead; there is no act-as-partner mode.
 *
 * Also enforces the partner company's LIVE status, which is what makes
 * suspension immediate: proxy.ts gates on a token claim that cannot change
 * until the next login, so without this check a suspended partner would keep
 * working for the life of their session.
 */
export async function getPartnerViewer(request: NextRequest): Promise<PartnerViewer | null> {
  const viewer = await getViewerContext(request, { allowPartner: true });
  if (!viewer || !viewer.partnerId) return null;

  const partner = await findPartnerById(viewer.partnerId);
  // A binding pointing at a partner that no longer resolves is a broken
  // account, not an unrestricted one — fail closed.
  if (!partner || !isPartnerUsable(partner.status)) return null;

  return {
    userId: viewer.userId,
    username: viewer.username,
    name: viewer.name,
    role: viewer.role,
    partnerId: viewer.partnerId,
    partner
  };
}

/**
 * Tenancy assertion for any record carrying a partner_id.
 *
 * Partner routes must scope their QUERIES by partnerId (a `WHERE`, never a
 * post-filter) — this is the belt-and-braces check for the paths where a
 * record arrives by id, e.g. a detail route. Treats a record with no
 * partner_id at all as not belonging to anyone's portal, so an internal-only
 * record can never be reached through a partner route by guessing its id.
 */
export function partnerOwns(viewer: PartnerViewer, record: { partner_id?: string | null } | null | undefined): boolean {
  if (!record || !record.partner_id) return false;
  return record.partner_id === viewer.partnerId;
}
