import { requireHrPage } from '@/lib/hrPageGuard';
import { isCelebrationContributor } from '@/lib/hrAccess';
import CompanyCelebrationsView from '@/components/CompanyCelebrationsView';

export default async function CompanyCelebrationsPage() {
  const viewer = await requireHrPage('hr-celebrations');
  const canContribute = await isCelebrationContributor(viewer);
  return <CompanyCelebrationsView canManage={viewer.isHrManager} canContribute={canContribute} />;
}
