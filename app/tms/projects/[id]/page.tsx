import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsProjectDetailView from '@/components/TmsProjectDetailView';

export default async function TmsProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireTmsPage('tms-projects');
  const { id } = await params;
  return <TmsProjectDetailView projectId={id} currentUser={{ username: viewer.username, role: viewer.role }} />;
}
