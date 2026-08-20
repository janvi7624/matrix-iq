import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsProcurementDetailView from '@/components/TmsProcurementDetailView';

export default async function TmsProcurementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireTmsPage('tms-procurement');
  const { id } = await params;
  return <TmsProcurementDetailView procurementId={id} currentUser={{ username: viewer.username, role: viewer.role }} />;
}
