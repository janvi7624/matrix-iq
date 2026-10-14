import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readDateParam } from '@/lib/dailyReportApi';
import { buildTeamDailyReports } from '@/lib/dailyReportService';
import { canAccessTeamDashboard } from '@/lib/dailyReportAccess';

// GET /api/daily-reports/team?date=&departmentId=&search=&status=
//
// The manager dashboard. Built from the expected set, so missing reports are
// rows rather than absences — see buildTeamDailyReports.
//
// Scope is resolved from the viewer, never from the query string: a
// departmentId parameter can only ever narrow what the viewer may already
// see, so passing someone else's department id returns their own scope
// rather than a leak.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'team-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  // The module gate alone is not enough here: 'team-daily-reports' is
  // manager-gated in Module Manager, and this re-checks that the viewer
  // genuinely manages a department (or sees org-wide), which is the actual
  // authority for reading other people's reports.
  if (!(await canAccessTeamDashboard(viewer))) {
    return NextResponse.json({ error: 'Forbidden — you do not manage a department.' }, { status: 403 });
  }

  try {
    const params = request.nextUrl.searchParams;
    return NextResponse.json(
      await buildTeamDailyReports(viewer, {
        date: readDateParam(request),
        departmentId: params.get('departmentId') || undefined,
        search: params.get('search') || undefined,
        status: params.get('status') || undefined
      })
    );
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
