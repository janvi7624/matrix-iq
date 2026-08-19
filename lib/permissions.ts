import { findRoleByKey } from './roleStore';
import { listDepartmentManagers } from './departmentStore';
import { GlobalCapability, ModulePermissionAction } from './types';

// Legacy fallback if a role key isn't found in the store at all (shouldn't
// happen once roleStore's seed has run, but keeps behavior identical to the
// original hardcoded proxy.ts/viewerContext.ts checks if it ever does).
function legacyIsPrivileged(role: string): boolean {
  return role === 'admin' || role === 'superadmin' || role === 'manager';
}

// The one chokepoint every "sees org-wide data vs only their own records"
// decision across the app already flows through (lib/viewerContext.ts) and
// the /admin/* route-area gate (proxy.ts) — generalizing this single
// function is what makes a brand-new admin-created role's isPrivileged flag
// take effect everywhere, without touching any of the ~35 route files that
// merely consume the resulting boolean.
export async function resolveIsPrivileged(role: string): Promise<boolean> {
  const record = await findRoleByKey(role);
  if (record) return record.status === 'active' && record.isPrivileged;
  return legacyIsPrivileged(role);
}

export async function hasCapability(role: string, capability: GlobalCapability): Promise<boolean> {
  const record = await findRoleByKey(role);
  if (!record || record.status !== 'active') return false;
  return !!record.permissions[capability];
}

// Additive, safe-by-default module action check for the newer (Section 19/20)
// data-driven modules: an explicit true/false in a role's matrix wins;
// with no override configured, it falls back to the same isPrivileged tier
// that already gated the action before Role Management existed — so nothing
// changes for the 6 built-in roles until an admin edits the matrix.
export async function isModuleActionAllowed(viewer: { role: string; isPrivileged: boolean }, moduleKey: string, action: ModulePermissionAction): Promise<boolean> {
  const record = await findRoleByKey(viewer.role);
  const entry = record?.status === 'active' ? record.permissions.modules[moduleKey] : undefined;
  if (entry && typeof entry[action] === 'boolean') return entry[action] as boolean;
  return viewer.isPrivileged;
}

// Who is authorized to review/approve/assign Marketing Requests — resolved
// from the real org structure (Department = "Marketing", Role = Manager,
// via Department.managerIds) rather than a single hardcoded user id or a
// flat role permission, same precedent as demo-schedule's manager-approval
// route. Falls back to the old flat isModuleActionAllowed('approve') check
// when no department literally named "Marketing" exists yet or it has no
// manager mapped, so nothing gets stuck on an unmapped org.
export async function isMarketingManager(viewer: { username: string; role: string; isPrivileged: boolean }): Promise<boolean> {
  if (await hasCapability(viewer.role, 'viewAllDepartments')) return true;
  const managers = (await listDepartmentManagers())['Marketing'];
  if (managers && managers.length) return managers.some((m) => m.username === viewer.username);
  if (viewer.isPrivileged) return true;
  return isModuleActionAllowed(viewer, 'marketing-requests', 'approve');
}
