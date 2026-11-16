import { ViewerContext } from './viewerContext';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { isModuleActionAllowed } from './permissions';
import { ModulePermissionAction } from './types';
import { listDepartmentManagers, findHrManagers, isUserADepartmentManager } from './departmentStore';

// HR module keys — all gated via HR_RESTRICTED_KEYS in moduleConfigStore.ts
// (HR + Admin + Super Admin only, not the generic isPrivileged bypass every
// department 'manager' account otherwise gets).
// hr-attendance/hr-leave are retired module keys (see moduleConfigStore.ts's
// RETIRED_KEYS) — kept here so the still-present-but-now-unreachable
// app/hr/attendance and app/hr/leave pages (redirected away by
// requireHrPage once the key no longer resolves) keep type-checking rather
// than being force-deleted along with the module removal.
export const HR_MODULE_KEYS = ['hr-employees', 'hr-attendance', 'hr-leave', 'hr-reports', 'hr-festivals', 'hr-celebrations'] as const;
export type HrModuleKey = (typeof HR_MODULE_KEYS)[number];

// "HR manager" reuses the SAME definition Reimbursement's HR-decide/
// deadline-extend routes already use — whoever Department Master lists as a
// manager of the department matching /^hr\b/i (today: "HR & Admin") — not a
// separate bespoke role. Privileged (admin/superadmin) always overrides.
export async function isHrManager(viewer: Pick<ViewerContext, 'username' | 'isPrivileged'>): Promise<boolean> {
  if (viewer.isPrivileged) return true;
  const allManagers = await listDepartmentManagers();
  return findHrManagers(allManagers).some((m) => m.username === viewer.username);
}

// A narrower right than isHrManager, for the Company Celebration wall only:
// any department manager (not just HR's own) may upload a photo/video and
// create a new album for it — HR still owns the wall's structure (folders,
// renaming/deleting whole albums), but a manager should be able to post
// their own team's celebration content without going through HR first, and
// edit/delete what THEY posted afterward (see app/api/hr/celebrations's
// per-item ownership check — this function only answers "is this viewer a
// manager at all", not "do they own this specific item").
export async function isCelebrationContributor(viewer: Pick<ViewerContext, 'username' | 'isPrivileged'>): Promise<boolean> {
  if (await isHrManager(viewer)) return true;
  return isUserADepartmentManager(viewer.username);
}

export async function requireHrModule(viewer: ViewerContext, moduleKey: HrModuleKey): Promise<boolean> {
  return isModuleAccessAllowed(moduleKey, viewer);
}

export async function requireHrAction(viewer: ViewerContext, moduleKey: HrModuleKey, action: ModulePermissionAction): Promise<boolean> {
  if (!(await requireHrModule(viewer, moduleKey))) return false;
  return isModuleActionAllowed(viewer, moduleKey, action);
}
