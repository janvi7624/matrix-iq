import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { buildDailyReportAnalytics } from '@/lib/dailyReportAnalytics';
import { resolveDailyReportScope } from '@/lib/dailyReportAccess';
import { istDate, monthKey } from '@/lib/dailyReportTime';
import { isUuidLike } from '@/lib/dailyReportApiIds';

// GET /api/daily-reports/analytics?month=YYYY-MM&departmentId=&employeeId=
//
// Compliance for one calendar month. Narrowed to the viewer's own scope
// exactly like the team dashboard — a department manager sees their
// department's compliance, an org-wide viewer sees everyone's.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'team-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  try {
    const scope = await resolveDailyReportScope(viewer);
    if (!scope.seesOrgWide && !scope.departmentIds.length) {
      return NextResponse.json({ error: 'Forbidden — you do not manage a department.' }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const month = params.get('month');
    const requestedDepartment = params.get('departmentId');
    const employeeId = params.get('employeeId');

    return NextResponse.json(
      await buildDailyReportAnalytics({
        monthKey: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : monthKey(istDate(new Date())),
        // A departmentId in the query can only narrow within scope, never
        // widen it — same rule as the team dashboard.
        departmentIds:
          requestedDepartment && scope.departmentIds.includes(requestedDepartment) ? [requestedDepartment] : scope.departmentIds,
        employeeId: employeeId && isUuidLike(employeeId) ? employeeId : undefined
      })
    );
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
