import { NextRequest } from 'next/server';
import { getSessionFromRequest } from './auth';
import { UserRole } from './types';
import { resolveIsPrivileged } from './permissions';
import { findUserStatusById } from './userStore';

export interface ViewerContext {
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  isPrivileged: boolean; // this role's isPrivileged flag (Role Management) — sees every record, not just their own
  // The external partner company this account belongs to, or '' for internal
  // staff. Resolved live from the users row, never from the session token.
  // Almost every caller can ignore this: getViewerContext refuses partner
  // accounts unless explicitly asked not to (see below), so an internal route
  // that already compiles is already partner-free.
  partnerId: string;
}

export interface ViewerContextOptions {
  /**
   * Opt in to resolving PARTNER accounts too. Default false.
   *
   * This default is the single most load-bearing line in the Partner Portal's
   * isolation model. getViewerContext is the chokepoint ~every internal API
   * in this app already calls, so defaulting to "partners are not valid
   * viewers here" hardens all of them at once, rather than relying on ~35
   * route files each remembering to add a check — which is exactly the kind
   * of per-call-site discipline that fails quietly the first time someone
   * adds route number 36.
   *
   * Only two kinds of caller should pass true:
   *   - routes genuinely shared by both audiences (e.g. /api/sidebar, which
   *     renders the nav for whoever is signed in), and
   *   - lib/partnerContext.ts, which then narrows to partners specifically.
   * Even then, the route still owes its own partner-scoped authorization —
   * this flag only says "a partner may be resolved here", never "a partner
   * may see this data".
   */
  allowPartner?: boolean;
}

// Shared "who is asking, and do they see everyone's records or just their
// own" resolution for the site-visit/CRM/demo-schedule/travel-schedule/
// project-pipeline modules, which every logged-in role can use (unlike
// /api/admin/*). "technical"/"backoffice" are intentionally NOT privileged
// by default — see the UserRole comment in lib/types.ts for why
// assignment-based visibility isn't wired up yet. isPrivileged now comes from
// the role's record in Role Management (lib/roleStore.ts) instead of a fixed
// 3-role check, so an admin-created role's isPrivileged flag takes effect
// here automatically.
export async function getViewerContext(request: NextRequest, options?: ViewerContextOptions): Promise<ViewerContext | null> {
  const session = await getSessionFromRequest(request);
  if (!session) return null;
  // The session token has no server-side revocation of its own — this closes
  // that gap for every route that resolves a viewer through here: a
  // deactivated/deleted account's already-issued token stops working on its
  // very next call into this function, instead of staying valid for the rest
  // of its (up to 8-hour) lifetime. Deliberately NOT done in proxy.ts/lib/
  // auth.ts — see the comment in proxy.ts on why that file must stay free of
  // any Sequelize-touching import.
  // Independent lookups (one hits users, the other the cached roles list) —
  // run them concurrently instead of one-after-another. Neither depends on
  // the other's result.
  const [currentUser, isPrivileged] = await Promise.all([findUserStatusById(session.sub), resolveIsPrivileged(session.role)]);
  if (!currentUser || currentUser.status === 'inactive') return null;
  // Deny-by-default for external partner accounts — see ViewerContextOptions.
  // Resolved from the users row rather than session.partnerId: a token claim
  // is fine for route-area gating in proxy.ts, but this is the check every
  // internal API's authorization rests on, so it reads the live binding.
  if (currentUser.partnerId && !options?.allowPartner) return null;
  return {
    userId: currentUser.id,
    username: session.username,
    name: currentUser.name || session.username,
    role: session.role,
    isPrivileged,
    partnerId: currentUser.partnerId
  };
}
