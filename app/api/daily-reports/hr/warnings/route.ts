import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { listWarningGroups } from '@/lib/dailyReportWarningStore';
import { canAccessHrReview } from '@/lib/dailyReportAccess';
import { getDailyReportConfig } from '@/lib/dailyReportConfigStore';
import { istDate, monthKey } from '@/lib/dailyReportTime';

// GET /api/daily-reports/hr/warnings?month=YYYY-MM&view=all|active|escalated
//
// Warnings grouped by employee and calendar month — the grain HR actually
// works in, and the grain the escalation threshold is defined on. Each group
// carries its active and waived counts, the missed dates, whether those
// dates run consecutively or are scattered, and whether HR has already been
// escalated to.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'hr-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  if (!(await canAccessHrReview(guard.viewer))) {
    return NextResponse.json({ error: 'Forbidden — HR review is limited to HR managers and administrators.' }, { status: 403 });
  }

  try {
    const params = request.nextUrl.searchParams;
    const month = params.get('month');
    const view = params.get('view');
    const config = await getDailyReportConfig();

    const groups = await listWarningGroups(
      {
        monthKey: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : monthKey(istDate(new Date())),
        view: view === 'active' || view === 'escalated' ? view : 'all',
        search: params.get('search') || undefined
      },
      config.warning_threshold
    );

    return NextResponse.json({ groups, threshold: config.warning_threshold });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
