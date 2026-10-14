import { Suspense } from 'react';
import { requireDailyReportPage } from '@/lib/dailyReportPageGuard';
import DailyReportsPageView from '@/components/DailyReportsPageView';
import { isIsoDate } from '@/lib/dailyReportTime';

// Workspace › Daily Report — the merged module.
//
// One page, two tabs: the employee's own report always, plus Team Daily
// Reports for whoever actually manages a team (see
// components/DailyReportsPageView.tsx and ABSORBED_INTO_MERGED_PAGE in
// lib/moduleConfigStore.ts).
//
// `?date=` is honoured so every link the module sends out — the 9 PM
// reminder, the final reminder, a warning notice, an HR leave decision —
// lands on the exact reporting date it is about rather than on today.
// `?tab=team&report=` is where the submission notification points.
//
// Suspense is required because the view reads useSearchParams.
export default async function DailyReportPage({
  searchParams
}: {
  searchParams: Promise<{ date?: string; report?: string }>;
}) {
  // Returns canViewTeam, resolved from the same department-manager rule the
  // team API enforces — not from a role string, which cannot express
  // "manages some department".
  const viewer = await requireDailyReportPage();
  const { date, report } = await searchParams;

  return (
    <Suspense fallback={null}>
      <DailyReportsPageView
        canViewTeam={viewer.canViewTeam}
        initialDate={date && isIsoDate(date) ? date : undefined}
        initialReportId={report}
      />
    </Suspense>
  );
}
