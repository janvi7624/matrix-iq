import { hasCapability, isModuleActionAllowed } from './permissions';
import { listDepartmentManagers } from './departmentStore';
import { resolveVisibilityScope } from './departmentScope';
import { db } from './db';

// Who may manage Sales Team targets (Manager → Target Details). Structurally
// identical to lib/permissions.ts's canAssignLeads — an org-wide viewer
// always can; otherwise it's whoever Department Master actually lists as a
// manager of a sales-side department (independent of their login role), with
// the module-permission matrix as the escape hatch for orgs whose structure
// doesn't match these department names.
export const TARGET_MANAGER_DEPARTMENTS = ['Sales', 'GEM - Sales'];

export async function canManageTargets(viewer: { username: string; role: string; isPrivileged: boolean }): Promise<boolean> {
  if (await hasCapability(viewer.role, 'viewAllDepartments')) return true;
  const managersByDepartment = await listDepartmentManagers();
  const isSalesManager = TARGET_MANAGER_DEPARTMENTS.some((name) =>
    (managersByDepartment[name] || []).some((m) => m.username === viewer.username)
  );
  if (isSalesManager) return true;
  if (viewer.isPrivileged) return true;
  return isModuleActionAllowed(viewer, 'targets', 'manage');
}

export interface SalesTeamMember {
  id: string;
  username: string;
  name: string;
  department: string;
  designation: string;
}

// The Sales Team roster this module is actually about — active users in the
// Sales/GEM-Sales departments — intersected with the viewer's own visibility
// scope (org-wide sees the whole roster; a department-scoped Sales manager
// sees only their own managed team, which is already Sales-only by
// definition). Never returns an employee outside the viewer's authorized
// scope, even if canManageTargets granted access via the module-permission
// escape hatch for a non-Sales-department viewer.
export async function listSalesTeamRoster(viewerUsername: string): Promise<SalesTeamMember[]> {
  const scope = await resolveVisibilityScope(viewerUsername);
  const departments = await db.Department.findAll({ where: { name: TARGET_MANAGER_DEPARTMENTS } as never, attributes: ['id'] });
  const departmentIds = departments.map((d) => d.get('id') as string);
  if (!departmentIds.length) return [];

  const where: Record<string, unknown> = { status: 'active', departmentId: departmentIds };
  if (!scope.seesOrgWide) where.id = scope.scopedUserIds ?? [];

  const rows = await db.User.findAll({
    where: where as never,
    include: [{ model: db.Department, as: 'departmentRef', attributes: ['name'] }],
    attributes: ['id', 'username', 'name', 'designation']
  });
  return rows.map((r) => {
    const p = r.get({ plain: true }) as Record<string, unknown>;
    const dept = p.departmentRef as { name?: string } | null;
    return { id: p.id as string, username: p.username as string, name: (p.name as string) || (p.username as string), department: dept?.name ?? '', designation: (p.designation as string) ?? '' };
  });
}
