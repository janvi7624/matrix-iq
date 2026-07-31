import { NextRequest } from 'next/server';
import { getSessionFromRequest } from './auth';
import { UserRole } from './types';
import { resolveIsPrivileged } from './permissions';

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
  const isPrivileged = await resolveIsPrivileged(session.role);
  return { username: session.username, role: session.role, isPrivileged };
}
