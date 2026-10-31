import { NextResponse, NextRequest } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readDateParam } from '@/lib/dailyReportApi';
import { buildTeamDailyReportsRange } from '@/lib/dailyReportService';
import { canAccessTeamDashboard } from '@/lib/dailyReportAccess';

// GET /api/daily-reports/team/range?from=&to=&label=&departmentId=&search=
//
// The Month/Quarter/Year/Custom Range filters on Team Daily Reports — see
// buildTeamDailyReportsRange's doc comment for why this is a separate
// endpoint rather than teaching /team a second shape of response. Same guard
// as that route: 'daily-report' module access (NOT 'team-daily-reports' —
// that key is MANAGER_GATED and only passes for viewer.isPrivileged OR
// viewer.isDepartmentManager, a flag guardDailyReport never sets, so it
// could never pass for a non-privileged department manager), then a genuine
// department-manager check (or org-wide), not a role string.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  if (!(await canAccessTeamDashboard(viewer))) {
    return NextResponse.json({ error: 'Forbidden — you do not manage a department.' }, { status: 403 });
  }

  const from = readDateParam(request, 'from');
  const to = readDateParam(request, 'to');
  if (!from || !to) return NextResponse.json({ error: 'from and to must both be YYYY-MM-DD dates.' }, { status: 400 });
  if (from > to) return NextResponse.json({ error: '"from" must not be after "to".' }, { status: 400 });

  try {
    const params = request.nextUrl.searchParams;
    return NextResponse.json(
      await buildTeamDailyReportsRange(viewer, {
        from,
        to,
        label: params.get('label') || undefined,
        departmentId: params.get('departmentId') || undefined,
        search: params.get('search') || undefined
      })
    );
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
