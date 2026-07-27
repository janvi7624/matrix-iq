import { NextRequest } from 'next/server';
import { getSessionFromRequest } from './auth';

export interface ViewerContext {
  username: string;
  isPrivileged: boolean; // admin or superadmin — sees every record, not just their own
}

// Shared "who is asking, and do they see everyone's records or just their
// own" resolution for the site-visit/CRM/demo-schedule/travel-schedule
// modules, which every logged-in role can use (unlike /api/admin/*).
export async function getViewerContext(request: NextRequest): Promise<ViewerContext | null> {
  const session = await getSessionFromRequest(request);
  if (!session) return null;
  return { username: session.username, isPrivileged: session.role === 'admin' || session.role === 'superadmin' };
}
