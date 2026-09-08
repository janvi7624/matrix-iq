import { ViewerContext } from './viewerContext';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { isUserADepartmentManager } from './departmentStore';

// Generalizes lib/hrAccess.ts's isHrManager to every department: a
// "department manager" here means recognized via Department.managerIds
// (lib/departmentStore.ts), not any particular role — Sales, Accounts, AI,
// Robotics, AV, R&D, ... managers don't share one role the way HR's do.
export async function isTeamTaskManager(viewer: Pick<ViewerContext, 'username' | 'isPrivileged'>): Promise<boolean> {
  if (viewer.isPrivileged) return true;
  return isUserADepartmentManager(viewer.username);
}

export async function requireTeamTasksModule(viewer: ViewerContext): Promise<boolean> {
  const isDeptManager = await isTeamTaskManager(viewer);
  return isModuleAccessAllowed('team-tasks', { role: viewer.role, isPrivileged: viewer.isPrivileged, isDepartmentManager: isDeptManager });
}
