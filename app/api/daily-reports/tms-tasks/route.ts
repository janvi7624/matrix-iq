import { NextRequest, NextResponse } from 'next/server';
import { guardDailyReport, dailyReportErrorResponse, isGuardFailure } from '@/lib/dailyReportApi';
import { resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { getTmsViewer, isTmsAdminTier, canManageAllTmsTasks, tmsTeamDepartmentIds } from '@/lib/tmsAccess';
import { tmsTaskStore } from '@/lib/tmsTaskStore';
import { db } from '@/lib/db';

// The AI Daily Report's "Select Existing TMS Task" picker — the employee's
// own open TMS work, to attach a day's report to. Same access shape as
// sales-auto-detail/route.ts: omitted employeeId means self (the common
// case — an employee linking their own task); an explicit one is only ever
// sent by a manager using "File for Them".
//
// Two gates, not one, because they answer different questions. Daily-Report
// access (resolveEmployeeAccess) asks "may this viewer act on THIS
// EMPLOYEE's report" — true for the employee themself, or a manager who
// manages their department. TMS access asks a completely separate question
// — "does this viewer have any business seeing TMS task detail at all" —
// and a company-wide Daily Report reader (HR, say) passing the first gate
// is not automatically owed the second. For the self case the two always
// agree in practice (you can always see your own TMS tasks), so this only
// actually bites a manager filing on someone else's behalf — and only if
// manager-filers were ever allowed for a department whose manager carries
// no real TMS rights, which does not describe anyone today.
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

    const tasks = await tmsTaskStore.listForAssignee(employeeId);
    const open = tasks
      .filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        projectName: t.project_name,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date,
        progressPercent: t.progress_percent
      }));

    return NextResponse.json({ tasks: open });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
