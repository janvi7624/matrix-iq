import { NextRequest } from 'next/server';
import { getSessionFromRequest } from './auth';
import { UserRole } from './types';
import { resolveIsPrivileged } from './permissions';
import { findUserStatusById } from './userStore';

export interface ViewerContext {
  username: string;
  role: UserRole;
  isPrivileged: boolean; // this role's isPrivileged flag (Role Management) — sees every record, not just their own
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
export async function getViewerContext(request: NextRequest): Promise<ViewerContext | null> {
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
  return { username: session.username, role: session.role, isPrivileged };
}
