import { requireHrPage } from '@/lib/hrPageGuard';
import HrEmployeesView from '@/components/HrEmployeesView';

export default async function HrEmployeesPage() {
  const viewer = await requireHrPage('hr-employees');
  return <HrEmployeesView canCreate={viewer.isHrManager} />;
}
