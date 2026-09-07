import { requireHrPage } from '@/lib/hrPageGuard';
import HrEmployeesView from '@/components/HrEmployeesView';

export default async function HrEmployeesPage() {
  await requireHrPage('hr-employees');
  return <HrEmployeesView />;
}
