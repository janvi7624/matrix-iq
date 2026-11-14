import { QueryTypes } from 'sequelize';
import { sequelize } from './db';
import { resolveVisibilityScope } from './departmentScope';
import { listDepartmentManagers, findHrManagers } from './departmentStore';

// Who may do what in Employee Appreciation.
//
//  - SUBMIT: department managers / department heads (Department Master
//    managers, or anyone with direct reports) for their own department and
//    direct reports; admin / superadmin for anyone.
//  - DECIDE: the HR Manager (manager of the /^hr\b/i department — the same
//    definition Reimbursement's HR decision uses) or admin / superadmin.
//    Deliberately NOT viewer.isPrivileged: that flag is true for every
//    'manager' account, which would let any Sales manager approve.

interface ViewerLike {
  userId: string;
  username: string;
  role: string;
}

export interface PickableEmployee {
  id: string;
  name: string;
  department: string;
  designation: string;
}

const isAdminRole = (role: string) => role === 'admin' || role === 'superadmin';

export async function isAppreciationDecider(viewer: ViewerLike): Promise<boolean> {
  if (isAdminRole(viewer.role)) return true;
  return findHrManagers(await listDepartmentManagers()).some((m) => m.username === viewer.username);
}

/** The employees this viewer may appreciate. Empty means they may not submit. */
export async function pickableEmployees(viewer: ViewerLike): Promise<PickableEmployee[]> {
  const scope = await resolveVisibilityScope(viewer.username);
  const orgWide = isAdminRole(viewer.role) || scope.seesOrgWide;
  const ids = orgWide ? null : (scope.scopedUserIds || []).filter((id) => id !== viewer.userId);
  if (ids && ids.length === 0) return [];

  return sequelize.query<PickableEmployee>(
    `SELECT id, COALESCE(name, username) AS name, COALESCE(department, '') AS department, COALESCE(designation, '') AS designation
     FROM users
     WHERE status = 'active' AND "deletedAt" IS NULL AND "partnerId" IS NULL AND id <> $self
       ${ids ? 'AND id = ANY($ids::uuid[])' : ''}
     ORDER BY name`,
    { bind: { self: viewer.userId, ...(ids ? { ids } : {}) }, type: QueryTypes.SELECT }
  );
}

export async function canSubmitAppreciation(viewer: ViewerLike): Promise<boolean> {
  return (await pickableEmployees(viewer)).length > 0;
}
