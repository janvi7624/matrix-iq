import { requireTmsPage } from '@/lib/tmsPageGuard';
import TmsUsersView from '@/components/TmsUsersView';

export default async function TmsUsersPage() {
  const viewer = await requireTmsPage('tms-users');
  return <TmsUsersView currentUser={{ username: viewer.username, role: viewer.role }} />;
}
