import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsTaskDetailView from '@/components/TmsTaskDetailView';

export default async function TmsTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireTmsPage('tms-tasks');
  const { id } = await params;
  return <TmsTaskDetailView taskId={id} currentUser={{ username: viewer.username, role: viewer.role }} />;
}
