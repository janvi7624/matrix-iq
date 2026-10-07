import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsTasksView from '@/components/TmsTasksView';

export default async function TmsTasksPage() {
  const viewer = await requireTmsPage('tms-tasks');
  return <TmsTasksView currentUser={{ id: viewer.id, username: viewer.username, name: viewer.name, role: viewer.role }} />;
}
