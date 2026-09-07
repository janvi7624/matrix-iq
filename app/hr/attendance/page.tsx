import { requireHrPage } from '@/lib/hrPageGuard';
import HrAttendanceView from '@/components/HrAttendanceView';

export default async function HrAttendancePage() {
  const viewer = await requireHrPage('hr-attendance');
  return <HrAttendanceView isHrManager={viewer.isHrManager} />;
}
