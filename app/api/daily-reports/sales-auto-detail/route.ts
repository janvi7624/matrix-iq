import { NextRequest, NextResponse } from 'next/server';
import { guardDailyReport, dailyReportErrorResponse, isGuardFailure, readDateParam } from '@/lib/dailyReportApi';
import { resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { fetchSalesAutoDetail } from '@/lib/salesDailyAutoFetch';

// The records behind one auto-filled Sales/GEM-Sales matrix cell — what
// makes the "4" in "New Leads Generated — AI" clickable rather than just a
// number nobody can check. Same access rule as the report itself
// (resolveEmployeeAccess): the employee viewing their own day, or a manager/
// HR viewer who could already see that employee's report, and nobody else.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  // Omitted (DailyReportView, viewing your own day) means self — only
  // TeamDailyReportsView, which is explicitly about someone else's report,
  // ever sends a different id.
  const employeeId = request.nextUrl.searchParams.get('employeeId') || viewer.userId;
  const measure = request.nextUrl.searchParams.get('measure') || '';
  const channel = request.nextUrl.searchParams.get('channel') || '';
  const date = readDateParam(request);
  if (!measure || !channel || !date) {
    return NextResponse.json({ error: 'measure, channel and date are all required' }, { status: 400 });
  }

  try {
    const access = await resolveEmployeeAccess(viewer, employeeId);
    if (!access.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const items = await fetchSalesAutoDetail(employeeId, date, measure, channel);
    return NextResponse.json({ items });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
