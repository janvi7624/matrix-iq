import { QueryTypes } from 'sequelize';
import { sequelize } from './db';
import { directReportIdsFor } from './reportingManagers';
import { listDepartmentManagers, findHrManagers, departmentsManagedBy } from './departmentStore';

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
  // Only the HR Manager and admin / superadmin pick from the whole company.
  // Everyone else — including roles that see every department elsewhere — is
  // limited to the departments they manage and their direct reports.
  const orgWide = await isAppreciationDecider(viewer);
  let ids: string[] | null = null;
  if (!orgWide) {
    const [managed, direct] = await Promise.all([departmentsManagedBy(viewer.username), directReportIdsFor(viewer.userId)]);
    const members = managed.length
      ? await sequelize.query<{ id: string }>('SELECT id FROM users WHERE "departmentId" = ANY($d::uuid[])', { bind: { d: managed.map((m) => m.id) }, type: QueryTypes.SELECT })
      : [];
    ids = [...new Set([...members.map((m) => m.id), ...direct])].filter((id) => id !== viewer.userId);
  }
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
