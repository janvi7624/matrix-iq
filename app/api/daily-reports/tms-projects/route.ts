import { NextRequest, NextResponse } from 'next/server';
import { guardDailyReport, dailyReportErrorResponse, isGuardFailure } from '@/lib/dailyReportApi';
import { resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { getTmsViewer, isTmsAdminTier, canManageAllTmsTasks, tmsTeamDepartmentIds } from '@/lib/tmsAccess';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { listOngoingAssignedProjects } from '@/lib/projectStore';
import { db } from '@/lib/db';

// The AI Daily Report's "create a TMS task in one of my projects" dropdown —
// the employee's own TMS projects (project manager, creator, or team
// member — the same three-way test TMS's own "my projects" view already
// uses), so picking one and saving turns a plain row into a real tracked
// task without ever leaving Daily Report. Same two-gate shape as
// /api/daily-reports/tms-tasks: Daily-Report access first (may this viewer
// act on this employee's report), then a real TMS check for the non-self
// case (a manager filing on someone's behalf).
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  const employeeId = request.nextUrl.searchParams.get('employeeId') || viewer.userId;

  try {
    const access = await resolveEmployeeAccess(viewer, employeeId);
    if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const tmsViewer = await getTmsViewer(request);
    if (!tmsViewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (employeeId !== tmsViewer.userId) {
      const employee = await db.User.findByPk(employeeId, { attributes: ['departmentId'] });
      const employeeDepartmentId = employee?.get('departmentId') as string | undefined;
      const allowed =
        isTmsAdminTier(tmsViewer) ||
        ((await canManageAllTmsTasks(tmsViewer)) && !!employeeDepartmentId && (await tmsTeamDepartmentIds(tmsViewer)).includes(employeeDepartmentId));
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Two genuinely different things, never merged into one list: a TMS
    // project becomes a real tracked task on submit, while an ongoing Sales
    // Project the employee is formally the (or an additional) assigned
    // technical person on is just a note against that deal — nothing is
    // created in TMS for it. See TmsNewTaskProjectSelect.tsx for how the
    // picker keeps the two visually and behaviourally distinct.
    const [projects, salesProjects] = await Promise.all([
      tmsProjectStore.listForMember(employeeId),
      listOngoingAssignedProjects(employeeId)
    ]);
    return NextResponse.json({
      projects: projects.map((p) => ({ id: p.id, name: p.name, departmentName: p.department_name })),
      salesProjects
    });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
