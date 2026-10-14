import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { resolveTemplateForDepartment } from '@/lib/dailyReportTemplateStore';
import { canAccessTeamDashboard, resolveDailyReportScope } from '@/lib/dailyReportAccess';
import { isUuidLike } from '@/lib/dailyReportApiIds';

// GET /api/daily-reports/team/template?departmentId=…
//
// The resolved report format for one department, so a manager's "File for
// Them" dialog renders the SAME schema the employee would have been given —
// including that department's admin overrides. Fetching it rather than
// hardcoding it per department is what keeps a manager-filed report
// structurally identical to a self-filed one.
//
// Scoped like everything else on this screen: a department id outside the
// viewer's scope is refused rather than quietly answered, since the template
// reveals a department's reporting structure.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'team-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  if (!(await canAccessTeamDashboard(viewer))) {
    return NextResponse.json({ error: 'Forbidden — you do not manage a department.' }, { status: 403 });
  }

  const departmentId = request.nextUrl.searchParams.get('departmentId') || '';
  if (!isUuidLike(departmentId)) return NextResponse.json({ error: 'A valid departmentId is required.' }, { status: 400 });

  try {
    const scope = await resolveDailyReportScope(viewer);
    if (!scope.departmentIds.includes(departmentId)) {
      return NextResponse.json({ error: 'Forbidden — that department is not in your scope.' }, { status: 403 });
    }

    const resolved = await resolveTemplateForDepartment(departmentId);
    if (!resolved.configured) {
      return NextResponse.json(
        { error: 'That department has no approved daily report format yet, so a report cannot be filed for it.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ template: resolved.template, template_key: resolved.templateKey });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
