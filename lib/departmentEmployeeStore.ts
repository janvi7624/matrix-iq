import { db, isUuid } from './db';

export interface DepartmentEmployeeOption {
  id: string;
  username: string;
  name: string;
  designation: string;
}

// Active employees belonging to an arbitrary department — backs the
// Admin/HR "select Department, then Employee" cascading dropdown. Modeled
// on lib/targetAccess.ts's listSalesTeamRoster, parameterized by an
// arbitrary departmentId instead of a hardcoded department-name list, since
// this needs to work for ANY department, not just Sales.
export async function listActiveEmployeesForDepartment(departmentId: string): Promise<DepartmentEmployeeOption[]> {
  if (!isUuid(departmentId)) return [];
  const rows = await db.User.findAll({
    where: { departmentId, status: 'active' } as never,
    attributes: ['id', 'username', 'name', 'designation'],
    order: [['name', 'ASC']]
  });
  return rows.map((r) => ({
    id: r.get('id') as string,
    username: r.get('username') as string,
    name: (r.get('name') as string) || (r.get('username') as string),
    designation: (r.get('designation') as string) || ''
  }));
}

// Backend-side re-check: "does this employee actually belong to this
// department" — never trust the frontend's own cascading-dropdown selection,
// per the spec's explicit requirement.
export async function employeeBelongsToDepartment(userId: string, departmentId: string): Promise<boolean> {
  if (!isUuid(userId) || !isUuid(departmentId)) return false;
  const user = await db.User.findOne({ where: { id: userId, departmentId, status: 'active' } as never, attributes: ['id'] });
  return !!user;
}
