import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { buildMyDailyReportStatus } from '@/lib/dailyReportService';

// GET /api/daily-reports/me/status
//
// "Should I be asked to file today, and have I?" — nothing more.
//
// Deliberately NOT /me, which builds the template, a fortnight of history,
// the month's warning summary and the revision list. This runs on the
// dashboard, which every person loads on every visit, so it does the three
// lookups a shortcut actually needs and stops.
//
// The decision itself lives in buildMyDailyReportStatus so it can be tested
// without an HTTP request — its branching (excused, unconfigured,
// non-working day, leave claim) is the whole point of the endpoint.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;

  try {
    return NextResponse.json(await buildMyDailyReportStatus(guard.viewer.userId));
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
