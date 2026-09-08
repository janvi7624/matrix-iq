import { requireTeamTasksPage } from '@/lib/teamTasksPageGuard';
import TeamTasksView from '@/components/TeamTasksView';

export default async function TeamTasksPage() {
  const viewer = await requireTeamTasksPage();

  return (
    <TeamTasksView
      currentUser={{
        username: viewer.username,
        name: viewer.name,
        isPrivileged: viewer.isPrivileged,
        isDepartmentManager: viewer.isDepartmentManager,
        managedDepartments: viewer.managedDepartments
      }}
    />
  );
}
