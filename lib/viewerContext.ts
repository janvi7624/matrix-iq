import { NextRequest } from 'next/server';
import { getSessionFromRequest } from './auth';

export interface ViewerContext {
  username: string;
  isPrivileged: boolean; // admin/manager/superadmin — sees every record, not just their own
}

// Shared "who is asking, and do they see everyone's records or just their
// own" resolution for the site-visit/CRM/demo-schedule/travel-schedule/
// project-pipeline modules, which every logged-in role can use (unlike
// /api/admin/*). "technical" is intentionally NOT privileged here — see the
// UserRole comment in lib/types.ts for why assignment-based visibility isn't
// wired up yet.
export async function getViewerContext(request: NextRequest): Promise<ViewerContext | null> {
  const session = await getSessionFromRequest(request);
  if (!session) return null;
  const isPrivileged = session.role === 'admin' || session.role === 'superadmin' || session.role === 'manager';
  return { username: session.username, isPrivileged };
}
