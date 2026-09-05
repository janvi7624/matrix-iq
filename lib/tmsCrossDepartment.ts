import { db } from './db';
import { listDepartmentManagers } from './departmentStore';
import { notifyUsers } from './notificationStore';
import { TMS_ROLE_KEYS } from './tmsConstants';
import { TmsProjectRecord } from './types';

export interface CrossDepartmentCheckInput {
  project: TmsProjectRecord;
  assignee: { username: string; name: string; department: string };
  taskName: string;
  taskId: string;
  assignerName: string;
  assignerUsername: string;
  dueDate: string;
}

// Active technical-manager/team-lead users whose OWN profile department is
// `departmentName` — this, not Department.managerIds (listDepartmentManagers,
// a different pre-existing mechanism serving Sales-side approval routing for
// non-TMS departments like Administration/Accounts), is how "who manages
// this TMS department" is resolved everywhere else in TMS (see
// lib/tmsProjectStore.ts's list()/lib/tmsAccess.ts's isTmsManagerTier).
async function findTmsDepartmentManagers(departmentName: string): Promise<{ username: string }[]> {
  const managerRoleKeys = TMS_ROLE_KEYS.filter((r) => r === 'technical-manager' || r === 'team-lead');
  const rows = await db.User.findAll({
    where: { department: departmentName, status: 'active' } as never,
    include: [{ model: db.Role, as: 'role', where: { key: managerRoleKeys } as never, attributes: [] }],
    attributes: ['username']
  });
  return rows.map((r) => ({ username: r.get('username') as string }));
}

// A task's assignee is "cross-department" when their own department isn't
// among the project's department set (department_names for a combined
// project, else the single department_name) — notifies that department's
// TMS managers plus the project's own manager, since today only the
// assignee themself hears about a new/reassigned task. Silently a no-op for
// a same-department assignment (the overwhelming common case) or an
// assignee with no department on file.
export async function notifyIfCrossDepartmentAssignment(input: CrossDepartmentCheckInput): Promise<void> {
  if (!input.assignee.department) return;
  const projectDepartments = input.project.department_names.length ? input.project.department_names : [input.project.department_name];
  if (projectDepartments.includes(input.assignee.department)) return;

  const [tmsManagers, legacyManagers] = await Promise.all([
    findTmsDepartmentManagers(input.assignee.department),
    listDepartmentManagers().then((m) => m[input.assignee.department] || [])
  ]);

  const usernames = new Set([...tmsManagers.map((m) => m.username), ...legacyManagers.map((m) => m.username)]);
  if (input.project.project_manager_id) {
    const projectManager = await db.User.findByPk(input.project.project_manager_id, { attributes: ['username'] });
    if (projectManager) usernames.add(projectManager.get('username') as string);
  }
  usernames.delete(input.assignee.username);
  usernames.delete(input.assignerUsername);
  if (!usernames.size) return;

  await notifyUsers([...usernames], {
    title: 'Cross-Department Task Assignment',
    body: `Project: ${input.project.name}\nTask: ${input.taskName}\nAssigned To: ${input.assignee.name}\nAssigned By: ${input.assignerName}\nRequired By: ${input.dueDate || 'Not set'}`,
    type: 'tms_cross_department_assignment',
    entityType: 'tms_task',
    entityId: input.taskId
  });
}
