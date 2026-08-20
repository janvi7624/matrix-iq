import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsDashboardView from '@/components/TmsDashboardView';

export default async function TmsDashboardPage() {
  const viewer = await requireTmsPage('tms-dashboard');
  return <TmsDashboardView currentUser={{ username: viewer.username, role: viewer.role }} />;
}
