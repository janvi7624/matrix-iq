import { requireHrPage } from '@/lib/hrPageGuard';
import CompanyCelebrationsView from '@/components/CompanyCelebrationsView';

export default async function CompanyCelebrationsPage() {
  const viewer = await requireHrPage('hr-celebrations');
  return <CompanyCelebrationsView canManage={viewer.isHrManager} />;
}
