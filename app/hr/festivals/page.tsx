import { requireHrPage } from '@/lib/hrPageGuard';
import HrFestivalsView from '@/components/HrFestivalsView';

export default async function HrFestivalsPage() {
  await requireHrPage('hr-festivals');
  return <HrFestivalsView />;
}
