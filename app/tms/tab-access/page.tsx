import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsTabAccessView from '@/components/TmsTabAccessView';

export default async function TmsTabAccessPage() {
  const viewer = await requireTmsPage('tms-tab-access');
  return <TmsTabAccessView currentUser={{ username: viewer.username, role: viewer.role }} />;
}
