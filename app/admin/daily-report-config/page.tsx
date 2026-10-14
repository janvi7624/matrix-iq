import { requireDailyReportConfigPage } from '@/lib/dailyReportPageGuard';
import DailyReportConfigView from '@/components/DailyReportConfigView';

// Admin Settings › Daily Report Configuration.
//
// Narrower than the rest of /admin on purpose — see
// requireDailyReportConfigPage and canAccessDailyReportConfig: this screen
// arms a job that emails the whole company and decides who gets warned.
export default async function DailyReportConfigPage() {
  await requireDailyReportConfigPage();
  return <DailyReportConfigView />;
}
