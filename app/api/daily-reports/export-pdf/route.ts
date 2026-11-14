import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readDateParam } from '@/lib/dailyReportApi';
import { resolveDailyReportScope, resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { listFiledReportsForExport } from '@/lib/dailyReportStore';
import { buildDailyReportPdf } from '@/lib/dailyReportPdf';

// GET /api/daily-reports/export-pdf?from=&to=[&employeeId=][&departmentId=][&mine=1]
//
// The CONTENT of daily reports as a PDF — every filed day, what was written.
// Who may export whose reports is exactly who may READ them, resolved by the
// same helpers the rest of the module uses (lib/dailyReportAccess.ts):
//
//   mine=1           -> the viewer's own reports. Always allowed.
//   employeeId       -> one person: resolveEmployeeAccess().canView — self,
//                       their manager / reporting manager, HR manager, admin.
//   neither          -> everyone the viewer can read: org-wide for admin,
//                       every department for the HR manager, the managed
//                       departments + direct reports for a manager. A plain
//                       employee falls back to their own reports.
//   departmentId     -> narrows the above to one department; never widens it.

const MAX_RANGE_DAYS = 366;
const MAX_REPORTS = 3000;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reports';
}

export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  const from = readDateParam(request, 'from');
  const to = readDateParam(request, 'to');
  if (!from || !to) return NextResponse.json({ error: 'from and to must both be YYYY-MM-DD dates.' }, { status: 400 });
  if (from > to) return NextResponse.json({ error: '"from" must not be after "to".' }, { status: 400 });
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (spanDays > MAX_RANGE_DAYS) return NextResponse.json({ error: 'Pick a range of a year or less.' }, { status: 400 });

  const params = request.nextUrl.searchParams;
  const employeeId = params.get('employeeId') || '';
  const departmentId = params.get('departmentId') || '';
  const mine = params.get('mine') === '1';

  try {
    let filter: { all?: boolean; employeeIds?: string[]; departmentIds?: string[] };
    let title: string;
    let scopeLabel = '';

    if (mine || employeeId === viewer.userId) {
      filter = { employeeIds: [viewer.userId] };
      title = 'My Daily Reports'; scopeLabel = 'Own reports';
    } else if (employeeId) {
      const access = await resolveEmployeeAccess(viewer, employeeId);
      if (!access.canView) return NextResponse.json({ error: 'Forbidden — you cannot view this employee’s reports.' }, { status: 403 });
      filter = { employeeIds: [employeeId] };
      title = 'Employee Daily Reports'; scopeLabel = 'Single employee';
    } else {
      const scope = await resolveDailyReportScope(viewer);
      const hasTeam = scope.seesOrgWide || scope.departmentIds.length > 0 || scope.manageUserIds.length > 0;
      if (!hasTeam) {
        filter = { employeeIds: [viewer.userId] };
        title = 'My Daily Reports'; scopeLabel = 'Own reports';
      } else if (departmentId) {
        if (!scope.seesOrgWide && !scope.departmentIds.includes(departmentId)) {
          return NextResponse.json({ error: 'Forbidden — that department is outside your scope.' }, { status: 403 });
        }
        filter = { departmentIds: [departmentId] };
        const name = scope.departments.find((d) => d.id === departmentId)?.name ?? 'Department';
        title = `${name} — Daily Reports`; scopeLabel = `${name} department`;
      } else if (scope.seesOrgWide) {
        filter = { all: true };
        title = 'All Employees — Daily Reports'; scopeLabel = 'All departments (organisation-wide)';
      } else {
        filter = { departmentIds: scope.departmentIds, employeeIds: scope.manageUserIds };
        title = scope.isHr && scope.departmentIds.length > 1 ? 'All Employees — Daily Reports' : 'My Team — Daily Reports';
        scopeLabel = scope.departmentIds.length > 1 ? `${scope.departmentIds.length} departments in your scope` : 'Your team';
      }
    }

    const { reports, truncated, templates } = await listFiledReportsForExport({ from, to, ...filter, limit: MAX_REPORTS });
    if (employeeId && reports[0]) { title = `${reports[0].employee_name} — Daily Reports`; scopeLabel = `${reports[0].employee_name} (${reports[0].department_name})`; }

    const pdf = await buildDailyReportPdf({ title, scopeLabel, from, to, generatedBy: viewer.name || viewer.username, reports, templates, truncated });
    const filename = `${slug(title)}-${from}-to-${to}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
