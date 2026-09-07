import { requireHrPage } from '@/lib/hrPageGuard';
import HrReportsView from '@/components/HrReportsView';

export default async function HrReportsPage() {
  await requireHrPage('hr-reports');
  return <HrReportsView />;
}
