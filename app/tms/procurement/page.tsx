import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsProcurementView from '@/components/TmsProcurementView';

export default async function TmsProcurementPage() {
  const viewer = await requireTmsPage('tms-procurement');
  return <TmsProcurementView currentUser={{ username: viewer.username, role: viewer.role }} />;
}
