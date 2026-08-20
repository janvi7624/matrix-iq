import { NextRequest } from 'next/server';
import { getViewerContext, ViewerContext } from './viewerContext';
import { findUserByUsername } from './userStore';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { isModuleActionAllowed } from './permissions';
import { ModulePermissionAction } from './types';
import { db } from './db';
import { TmsModuleKey } from './tmsConstants';

// TMS (Technical Management System) — a self-contained module gated on BOTH
// department (Robotics/AI/AV/Marketing) and role/action permission. See the
// TMS plan doc for the full design; this file is the one chokepoint every
// app/api/tms/** route and app/tms/**/page.tsx (via lib/tmsPageGuard.ts)
// resolves access through, so "can see it" and "can call its API" can never
// drift apart. This is a SERVER-ONLY file (pulls in db/auth transitively via
// lib/db.ts) — 'use client' components must import the plain constants from
// lib/tmsConstants.ts instead, never from here, or Next tries to bundle
// Sequelize/pg for the browser.
export { TMS_DEPARTMENTS, TMS_ROLE_KEYS, TMS_MODULE_KEYS } from './tmsConstants';
export type { TmsModuleKey } from './tmsConstants';

export interface TmsViewer extends ViewerContext {
  department: string;
  // Real user id — needed to compare against raw FK columns like
  // TmsTaskRecord.assignee_id (created_by fields are resolved usernames by
  // convention, but assignee_id etc. stay raw ids — see the TMS stores).
  userId: string;
}

// Resolves the viewer, their department, AND their user id in one call —
// every app/api/tms/** route starts here instead of the plain
// getViewerContext(), since both are needed for the gates below.
export async function getTmsViewer(request: NextRequest): Promise<TmsViewer | null> {
  const viewer = await getViewerContext(request);
  if (!viewer) return null;
  const user = await findUserByUsername(viewer.username);
  return { ...viewer, department: user?.department ?? '', userId: user?.id ?? '' };
}

// Combined gate: module enabled + role-visible + department-visible (or
// privileged). This is the SAME check that decides whether the sidebar tile
// shows up (isModuleAccessAllowed) — reused here so "can't see it" and
// "can't call its API" can never drift apart.
export async function requireTmsModule(viewer: TmsViewer, moduleKey: TmsModuleKey): Promise<boolean> {
  return isModuleAccessAllowed(moduleKey, viewer);
}

export async function requireTmsAction(viewer: TmsViewer, moduleKey: TmsModuleKey, action: ModulePermissionAction): Promise<boolean> {
  if (!(await requireTmsModule(viewer, moduleKey))) return false;
  return isModuleActionAllowed(viewer, moduleKey, action);
}

// "Sees every task, not just their own" — Team Lead/Technical Manager (both
// carry manage:true on tms-tasks per the seeded permission matrix), or any
// privileged viewer. Engineer/Technician (no manage:true) fall through to
// assignee/creator-only in lib/tmsTaskStore.ts.
export async function canManageAllTmsTasks(viewer: TmsViewer): Promise<boolean> {
  if (viewer.isPrivileged) return true;
  return isModuleActionAllowed(viewer, 'tms-tasks', 'manage');
}

// Who reviews/approves BOM Requests + gets notified of new submissions —
// resolved from the ROLE (Technical Manager), not Department.managerIds (a
// different, pre-existing "who manages department X" concept serving
// demo-schedule/marketing-request routing) — the spec ties BOM approval to
// the Technical Manager ROLE specifically.
export async function findTechnicalManagers(): Promise<{ id: string; username: string; name: string }[]> {
  const rows = await db.User.findAll({
    include: [{ model: db.Role, as: 'role', where: { key: 'technical-manager' } as never, attributes: [] }],
    where: { status: 'active' } as never,
    attributes: ['id', 'username', 'name']
  });
  return rows.map((r) => ({ id: r.get('id') as string, username: r.get('username') as string, name: r.get('name') as string }));
}
