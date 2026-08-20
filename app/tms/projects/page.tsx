import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsProjectsView from '@/components/TmsProjectsView';

export default async function TmsProjectsPage() {
  const viewer = await requireTmsPage('tms-projects');
  return <TmsProjectsView currentUser={{ username: viewer.username, role: viewer.role }} />;
}
