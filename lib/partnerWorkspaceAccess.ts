import { Op } from 'sequelize';
import { db } from './db';
import { getAppConfig } from './appConfigStore';

// Who gets the "Partner" module, and what they see in it.
//
// The module exists because partner work was reachable only through
// /admin/partners, which is privileged-only — so the sales people who
// actually bring partners in could not open it, and the only ways to let
// them were to make them admins or to punch a hole in the admin gate.
// Neither is right: their partners are their own book of business, not an
// administrative function.
//
// So: one module, outside /admin, scoped per person. Whoever can create a
// partner, or is the relationship manager or creator of one, sees it — and
// sees THEIR partners in it. Nothing of anyone else's is mixed in.

export const PARTNER_WORKSPACE_MODULE_KEY = 'partner-workspace';

export function isPartnerWorkspaceModule(key: string): boolean {
  return key === PARTNER_WORKSPACE_MODULE_KEY;
}

/**
 * The tile/API gate, synchronous.
 *
 * `isPartnerStakeholder` is resolved by the caller and passed in — the same
 * shape listVisibleModules already uses for isDepartmentManager, and for the
 * same reason: that filter is synchronous and the answer needs a query.
 */
export function canSeePartnerWorkspace(viewer: { isPrivileged?: boolean; isPartnerStakeholder?: boolean }): boolean {
  return !!viewer.isPrivileged || !!viewer.isPartnerStakeholder;
}

/**
 * Is this person involved with any partner at all?
 *
 * Three ways in, in cost order:
 *   * named on AppConfig.partnerCreatorIds — they may create partners, so
 *     they get the module before they have created their first one;
 *   * the relationship manager of at least one partner;
 *   * the creator of at least one partner — which covers somebody removed
 *     from the creator list later; their existing partners stay reachable
 *     rather than becoming orphaned.
 */
export async function resolvePartnerStakeholder(userId: string): Promise<boolean> {
  if (!userId) return false;

  const config = await getAppConfig();
  if (config.partnerCreatorIds.includes(userId)) return true;

  const owned = await db.Partner.count({
    where: { [Op.or]: [{ relationship_manager_id: userId }, { created_by: userId }] } as never
  });
  return owned > 0;
}

/**
 * Which partners this person's workspace shows.
 *
 * Returns null for "everything" — the admin tier and anyone who can manage
 * partners org-wide keep the full list, because somebody has to be able to
 * pick up a partner whose owner has left. Everyone else sees exactly the
 * partners they are the creator or relationship manager of, which is the
 * "no mix-ups" rule: their own book, not the company's.
 */
export function partnerWorkspaceScope(viewer: {
  userId: string;
  seesAllPartners: boolean;
}): { ownerIds: string[] } | null {
  if (viewer.seesAllPartners) return null;
  return { ownerIds: [viewer.userId] };
}
