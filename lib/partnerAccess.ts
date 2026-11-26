import { hasCapability, isSalesLeadManager } from './permissions';
import { isModuleActionAllowed } from './permissions';
import { getAppConfig } from './appConfigStore';

/**
 * Who may create and run partner accounts.
 *
 * Resolved the same way lead routing already is (lib/permissions.ts's
 * canAssignLeads), and deliberately so: the requirement says "authorized
 * Sales Managers", but this app has no 'sales-manager' role — a sales
 * manager is whoever is listed in Department Master as a manager of Sales or
 * GEM - Sales (isSalesLeadManager). Inventing a new role for partners would
 * have created a second, parallel answer to "who runs sales", and the two
 * would drift the first time someone changed departments.
 *
 * Order matters: the cheap capability check first, then department
 * membership, then the module matrix as the escape hatch for an org whose
 * structure doesn't match those department names.
 */
export async function canManagePartners(viewer: { username: string; role: string; isPrivileged: boolean }): Promise<boolean> {
  if (await hasCapability(viewer.role, 'viewAllDepartments')) return true;
  if (await isSalesLeadManager(viewer.username)) return true;
  if (viewer.isPrivileged) return true;
  return isModuleActionAllowed(viewer, 'partners', 'manage');
}

/**
 * Who may CREATE a partner account, and then owns it.
 *
 * Wider than canManagePartners by a named list of individuals
 * (AppConfig.partnerCreatorIds). The people who bring partners in are
 * ordinary sales staff on the generic 'user' role, shared with a dozen other
 * accounts — so the role matrix cannot express "these two" without granting
 * it to all of them. The list is additive only: everyone who could already
 * manage partners still can.
 *
 * Creating is separated from managing because the two are different jobs
 * here. A creator owns the partners they bring in — they approve that
 * partner's onboarding documents and watch their activity — but has no
 * business editing somebody else's partners, which canManagePartners still
 * governs.
 */
export async function canCreatePartner(viewer: { userId?: string; username: string; role: string; isPrivileged: boolean }): Promise<boolean> {
  if (await canManagePartners(viewer)) return true;
  if (!viewer.userId) return false;
  const config = await getAppConfig();
  return config.partnerCreatorIds.includes(viewer.userId);
}

/**
 * Whether this user id is on the configured partner-creator list.
 *
 * Separate from canCreatePartner because the login route needs the answer
 * for the session claim and has only the user id at that point — no role
 * record, no viewer shape. Privileged accounts reach the partner routes via
 * isPrivileged already, so this is only about the named individuals.
 */
export async function isConfiguredPartnerCreator(userId: string): Promise<boolean> {
  if (!userId) return false;
  const config = await getAppConfig();
  return config.partnerCreatorIds.includes(userId);
}

/**
 * Who may approve or reject one partner's onboarding documents.
 *
 * The person who created the account, or its relationship manager — "the
 * account creator" from the requirement, with the RM included because
 * ownership is routinely handed over and a partner should not be stuck
 * waiting on someone who has left.
 *
 * Admins and sales managers keep their override, which is what stops a
 * partner being stranded when neither of those two people is available.
 */
export async function canReviewPartnerDocuments(
  viewer: { userId?: string; username: string; role: string; isPrivileged: boolean },
  partner: { created_by?: string | null; relationship_manager_id?: string | null }
): Promise<boolean> {
  if (viewer.userId && partner.created_by && viewer.userId === partner.created_by) return true;
  if (viewer.userId && partner.relationship_manager_id && viewer.userId === partner.relationship_manager_id) return true;
  return canManagePartners(viewer);
}

/**
 * Who may view or edit ONE SPECIFIC partner's own record, page, portal
 * logins and documents — the account's creator, its relationship manager, or
 * anyone who can manage partners org-wide. Same rule as
 * canReviewPartnerDocuments above (document approval and "may open this
 * partner's own page" are the same relationship, by the same person), reused
 * under its own name so a GET/PATCH on a single partner reads as what it
 * actually checks.
 *
 * This is the rule PartnerCreateView promises on the spot — "You will be
 * recorded as this partner's relationship manager, so it appears in your
 * Partner list and you approve its Agreement, NDA, GST and PAN" —
 * for an ordinary sales account with none of canManagePartners' org-wide
 * grants. Before this existed, every app/api/admin/partners/[id]/** route
 * checked canManagePartners ALONE, which is true only for an admin, a sales
 * lead manager, or someone with the viewAllDepartments capability — so the
 * very person that promise was made to got a 403 opening their own partner's
 * page, admin and sales-lead-manager accounts went on seeing it fine (hence
 * the bug surfacing as "works for me, broken for them").
 */
export async function canAccessPartnerRecord(
  viewer: { userId?: string; username: string; role: string; isPrivileged: boolean },
  partner: { created_by?: string | null; relationship_manager_id?: string | null }
): Promise<boolean> {
  return canReviewPartnerDocuments(viewer, partner);
}

/**
 * Who may DELETE a partner — nobody, through this module.
 *
 * Kept as an explicit named rule rather than simply omitting the route, so
 * the decision is discoverable instead of looking like an oversight. A
 * partner accumulates projects, quotations, demos and tickets, all of which
 * carry ON DELETE RESTRICT back to this row; ending a relationship is a
 * status change ('inactive'), which preserves the history every one of those
 * records depends on. This mirrors how the app already retires employees
 * (UserStatus 'inactive', never a row delete — see lib/types.ts).
 */
export const PARTNERS_ARE_NEVER_DELETED = true;
