import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { buildTeamMatrix, MatrixRangeError } from '@/lib/dailyReportMatrix';
import { canAccessTeamDashboard } from '@/lib/dailyReportAccess';
import { isIsoDate } from '@/lib/dailyReportTime';

// GET /api/daily-reports/team/matrix?from=&to=&departmentId=&search=&expand=
//
// The range view of the team dashboard: employees as rows, working days as
// columns, and optionally one employee's day-by-day tasks.
//
// Same two-step authorization as /api/daily-reports/team — the coarse
// 'daily-report' module gate, then canAccessTeamDashboard, which is the real
// authority for reading other people's reports. Deliberately NOT the
// manager-gated 'team-daily-reports' key: that gate cannot see the
// department-manager fact and so refuses HR and real managers alike.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  if (!(await canAccessTeamDashboard(viewer))) {
    return NextResponse.json({ error: 'Forbidden — you do not manage a department.' }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  // Validated rather than passed through: these reach a BETWEEN clause, and
  // an unparseable date would otherwise surface as a database error.
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    return NextResponse.json({ error: 'Dates must be in YYYY-MM-DD form.' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await buildTeamMatrix(viewer, {
        from: from || undefined,
        to: to || undefined,
        departmentId: params.get('departmentId') || undefined,
        search: params.get('search') || undefined,
        expand: params.get('expand') || undefined
      })
    );
  } catch (error) {
    if (error instanceof MatrixRangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return dailyReportErrorResponse(error);
  }
}
