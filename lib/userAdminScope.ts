import { listActiveRoles } from './roleStore';
import { resolveDepartmentOnlyScope } from './departmentScope';

// What a person may do in User Management, beyond "may reach the screen".
//
//  - superadmin / admin: everything they could before (the superadmin-only
//    rules stay in the routes).
//  - everyone else who reaches the screen — 'manager'-role accounts and
//    department heads on any role — works ONLY inside the departments they
//    manage (Department.managerIds), and may only hand out NON-admin roles:
//    no Super Admin, Admin, Manager, no role flagged isPrivileged in Role
//    Management, and no partner-portal role. Before this, a 'manager' account
//    could create or promote an Admin, since only Super Admin was blocked.

const ADMIN_TIER = new Set(['superadmin', 'admin']);
const ALWAYS_RESTRICTED = new Set(['superadmin', 'admin', 'manager']);

export interface UserAdminAuthority {
  /** superadmin / admin — unrestricted role assignment. */
  adminTier: boolean;
  /** Sees every user (viewAllDepartments). */
  seesOrgWide: boolean;
  /** User ids this person may list/edit (null when seesOrgWide). */
  scopedUserIds: string[] | null;
  /** Departments this person manages — where they may place users. */
  managedDepartmentNames: string[];
  /** Role keys this person may assign. */
  assignableRoleKeys: string[];
}

export async function resolveUserAdminAuthority(session: { username: string; role: string }): Promise<UserAdminAuthority> {
  const [scope, roles] = await Promise.all([resolveDepartmentOnlyScope(session.username), listActiveRoles()]);
  const adminTier = ADMIN_TIER.has(session.role);
  const assignableRoleKeys = adminTier
    ? roles.map((r) => r.key)
    : roles.filter((r) => !ALWAYS_RESTRICTED.has(r.key) && !r.isPrivileged && !r.key.startsWith('partner-')).map((r) => r.key);
  return {
    adminTier,
    seesOrgWide: scope.seesOrgWide,
    scopedUserIds: scope.scopedUserIds,
    managedDepartmentNames: scope.managedDepartmentNames,
    assignableRoleKeys
  };
}

/** May this person act on a user who currently holds `role`? */
export function canActOnRole(authority: UserAdminAuthority, role: string): boolean {
  return authority.adminTier || authority.assignableRoleKeys.includes(role);
}
