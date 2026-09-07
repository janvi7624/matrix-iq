import { requireHrPage } from '@/lib/hrPageGuard';
import HrTasksView from '@/components/HrTasksView';

export default async function HrTasksPage() {
  const viewer = await requireHrPage('hr-tasks');
  return <HrTasksView currentUser={{ username: viewer.username, name: viewer.name, isHrManager: viewer.isHrManager }} />;
}
