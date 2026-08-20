import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsBomRequestsView from '@/components/TmsBomRequestsView';

export default async function TmsBomRequestsPage() {
  const viewer = await requireTmsPage('tms-bom-requests');
  return <TmsBomRequestsView currentUser={{ username: viewer.username, role: viewer.role }} />;
}
