import { redirect } from 'next/navigation';

// Team Daily Reports was merged into /daily-reports as a second tab (see
// components/DailyReportsPageView.tsx). Kept as a redirect rather than
// deleted so nothing that already points here breaks: the "X submitted their
// daily report" notifications already sent carry
// /daily-reports/team?date=…&report=…, and the notification resolver's old
// href shape is stored on rows in the notifications table. Both params are
// forwarded so the redirect lands on the same report, not just the same page.
//
// Same pattern as app/my-quotations/page.tsx, which redirects onto
// /quotation?tab=existing for exactly this reason.
export default async function TeamDailyReportsRedirectPage({
  searchParams
}: {
  searchParams: Promise<{ date?: string; report?: string }>;
}) {
  const { date, report } = await searchParams;
  const query = new URLSearchParams({ tab: 'team' });
  if (date) query.set('date', date);
  if (report) query.set('report', report);
  redirect(`/daily-reports?${query.toString()}`);
}
