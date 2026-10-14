import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readDateParam } from '@/lib/dailyReportApi';
import { buildMyDailyReport, resolveEmployeeIdentity } from '@/lib/dailyReportService';

// GET /api/daily-reports/me?date=YYYY-MM-DD
//
// The employee's own report for one reporting date, plus their template,
// deadline, warning banner, live leave claim and recent history — one round
// trip, because the page needs all of it before it can render anything.
//
// Always scoped to the CALLER. There is deliberately no employeeId parameter
// here: a manager reading somebody else's report goes through the team
// endpoints, which apply the department-scope check. That keeps the one
// endpoint that can return DRAFT content unable to return anyone else's.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;

  try {
    const employee = await resolveEmployeeIdentity(guard.viewer.userId);
    if (!employee) return NextResponse.json({ error: 'Your employee record could not be found.' }, { status: 404 });
    if (!employee.departmentId) {
      // Superadmin accounts carry no department at all (see
      // lib/moduleConfigStore.ts) — there is no template to file, and saying
      // so is better than rendering an empty form that can never be saved.
      return NextResponse.json(
        { error: 'Your account has no department assigned, so there is no daily report format for you to file. Ask an administrator to set your department.' },
        { status: 409 }
      );
    }
    return NextResponse.json(await buildMyDailyReport(employee, readDateParam(request)));
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
