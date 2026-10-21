import { hasCapability, isSalesLeadManager } from './permissions';
import { isModuleActionAllowed } from './permissions';

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
