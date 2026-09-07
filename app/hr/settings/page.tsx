import { requireHrPage } from '@/lib/hrPageGuard';
import HrSettingsView from '@/components/HrSettingsView';

export default async function HrSettingsPage() {
  await requireHrPage('hr-settings');
  return <HrSettingsView />;
}
