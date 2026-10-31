import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readPayload } from '@/lib/dailyReportApi';
import { saveReport } from '@/lib/dailyReportStore';
import { canAccessTeamDashboard, resolveEmployeeAccess, resolveReportManagers } from '@/lib/dailyReportAccess';
import { resolveEmployeeIdentity } from '@/lib/dailyReportService';
import { findAssignmentByDepartmentId } from '@/lib/dailyReportTemplateStore';
import { notifyReportSubmitted } from '@/lib/dailyReportNotify';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { isIsoDate, isUuidLike } from '@/lib/dailyReportApiIds';

// POST /api/daily-reports/team/file-for-employee
//
// "File for Them": an authorized manager creates and submits a report on
// behalf of a team member who could not.
//
// The things that make this auditable rather than indistinguishable from a
// normal submission, all enforced below or in saveReport:
//   * The EMPLOYEE stays the report's owner (employee_id), so it counts for
//     their compliance and appears in their own history.
//   * The MANAGER is recorded as the actor (filed_by_user_id), and the row
//     is labelled as manager-filed everywhere it is displayed.
//   * It goes through the same validation and the same deadline rules, so a
//     manager-filed report submitted after 11:00 is SUBMITTED_LATE exactly
//     like the employee's own would have been. A manager cannot launder a
//     late report into an on-time one.
//   * The employee is told it happened. Somebody filing a report in your
//     name and you not knowing is not acceptable.
export async function POST(request: NextRequest) {
  // 'daily-report' here, not 'team-daily-reports': that key is
  // MANAGER_GATED (lib/moduleConfigStore.ts) and only ever passes for
  // viewer.isPrivileged OR viewer.isDepartmentManager — a flag guardDailyReport
  // never sets, so it could never pass for exactly the non-privileged
  // department managers this feature is for. The real, correctly-computed
  // check is canAccessTeamDashboard below.
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  if (!(await canAccessTeamDashboard(viewer))) {
    return NextResponse.json({ error: 'Forbidden — you do not manage a department.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const employeeId = (body as { employeeId?: unknown })?.employeeId;
  const reportDate = (body as { reportDate?: unknown })?.reportDate;
  if (typeof employeeId !== 'string' || !isUuidLike(employeeId)) {
    return NextResponse.json({ error: 'A valid employeeId is required.' }, { status: 400 });
  }
  if (typeof reportDate !== 'string' || !isIsoDate(reportDate)) {
    return NextResponse.json({ error: 'A valid reporting date (YYYY-MM-DD) is required.' }, { status: 400 });
  }
  const payload = readPayload(body);
  if (!payload) return NextResponse.json({ error: 'A report payload is required.' }, { status: 400 });

  try {
    const access = await resolveEmployeeAccess(viewer, employeeId);
    if (access.isSelf) {
      // Filing "for" yourself through this endpoint would stamp your own
      // report as manager-filed, which would quietly corrupt the
      // manager-filed analytics. The ordinary endpoint is right here.
      return NextResponse.json({ error: 'Use your own Daily Report page to file your own report.' }, { status: 400 });
    }
    if (!access.canFileForThem) return NextResponse.json({ error: 'Forbidden — this employee is not in a department you manage.' }, { status: 403 });

    const employee = await resolveEmployeeIdentity(employeeId);
    if (!employee?.departmentId) return NextResponse.json({ error: 'That employee has no department assigned.' }, { status: 409 });

    const mode = (body as { mode?: unknown })?.mode === 'draft' ? 'draft' : 'submit';
    const { report, justSubmitted } = await saveReport({
      employeeId: employee.id,
      departmentId: employee.departmentId,
      reportDate,
      payload,
      mode,
      actorId: viewer.userId,
      onBehalf: true
    });

    // The employee is always told, whether or not this was the transition
    // into submitted — a manager editing a report in their name matters to
    // them either way.
    await notifyUsers([employee.username], {
      title: `${viewer.name} filed your daily report for ${reportDate}`,
      body: `${viewer.name} ${justSubmitted ? 'submitted' : 'saved'} a daily report on your behalf for ${reportDate}. Open it to check it is right.`,
      type: 'daily_report_filed_for_you',
      entityType: 'daily_report',
      entityId: report.id
    });

    if (justSubmitted) {
      const assignment = await findAssignmentByDepartmentId(employee.departmentId);
      const managers = (await resolveReportManagers(employee.departmentName, assignment?.extraManagerIds ?? []))
        // The manager who just filed it does not need telling about it.
        .filter((m) => m.id !== viewer.userId);
      await notifyReportSubmitted({
        reportId: report.id,
        employeeId: employee.id,
        employeeName: employee.name,
        departmentName: employee.departmentName,
        reportDate,
        submittedAt: new Date(report.submitted_at),
        deadlineAt: new Date(report.deadline_at),
        late: report.is_late,
        entryCount: report.entries.length,
        managers
      });
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report',
      entityId: report.id,
      action: `Filed a daily report on behalf of ${employee.name} for ${reportDate}`,
      previousStatus: '',
      newStatus: report.submission_status,
      remarks: report.is_late ? 'Filed after the deadline — recorded as late' : '',
      ip: getClientIp(request)
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
