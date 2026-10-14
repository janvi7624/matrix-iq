import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readPagination } from '@/lib/dailyReportApi';
import { listClaims } from '@/lib/dailyReportLeaveClaimStore';
import { canAccessHrReview } from '@/lib/dailyReportAccess';
import { DailyReportLeaveClaimStatus } from '@/lib/dailyReportTypes';
import { isIsoDate } from '@/lib/dailyReportTime';

const STATUSES: DailyReportLeaveClaimStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

// GET /api/daily-reports/hr/leave-claims
//
// HR's queue, across every department — which is the point: HR decides leave
// exemptions company-wide, not within one department's scope. The breadth is
// granted here specifically, rather than by widening resolveDailyReportScope,
// so that being HR grants access to leave claims and warnings WITHOUT also
// granting the ability to read every employee's report content.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'hr-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  if (!(await canAccessHrReview(guard.viewer))) {
    return NextResponse.json({ error: 'Forbidden — HR review is limited to HR managers and administrators.' }, { status: 403 });
  }

  try {
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const from = params.get('from');
    const to = params.get('to');
    const { page, pageSize } = readPagination(request);

    const result = await listClaims({
      status: status && STATUSES.includes(status as DailyReportLeaveClaimStatus) ? (status as DailyReportLeaveClaimStatus) : undefined,
      from: from && isIsoDate(from) ? from : undefined,
      to: to && isIsoDate(to) ? to : undefined,
      search: params.get('search') || undefined,
      page,
      pageSize
    });
    return NextResponse.json(result);
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
