import { requireHrPage } from '@/lib/hrPageGuard';
import HrLeaveOversightView from '@/components/HrLeaveOversightView';

export default async function HrLeavePage() {
  await requireHrPage('hr-leave');
  return <HrLeaveOversightView />;
}
