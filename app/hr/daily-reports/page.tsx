import { requireHrDailyReportsPage } from '@/lib/dailyReportPageGuard';
import HrDailyReportReviewView from '@/components/HrDailyReportReviewView';

// Workspace › HR › Daily Report Review.
//
// `?tab=` lets a notification open the right tab — leave claims point at
// 'leave', escalations at 'warnings'.
export default async function HrDailyReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireHrDailyReportsPage();
  const { tab } = await searchParams;
  return <HrDailyReportReviewView initialTab={tab} />;
}
