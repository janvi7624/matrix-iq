import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsBomRequestDetailView from '@/components/TmsBomRequestDetailView';

export default async function TmsBomRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireTmsPage('tms-bom-requests');
  const { id } = await params;
  return <TmsBomRequestDetailView requestId={id} currentUser={{ id: viewer.id, username: viewer.username, role: viewer.role, isPrivileged: viewer.isPrivileged }} />;
}
