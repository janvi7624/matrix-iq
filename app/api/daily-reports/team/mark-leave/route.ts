import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { canAccessTeamDashboard, resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { resolveEmployeeIdentity } from '@/lib/dailyReportService';
import { markLeaveByManager } from '@/lib/dailyReportLeaveClaimStore';
import { validateManagerLeaveMark } from '@/lib/dailyReportManagerLeave';
import { istDate } from '@/lib/dailyReportTime';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { isUuidLike } from '@/lib/dailyReportApiIds';

// POST /api/daily-reports/team/mark-leave
//
// "Mark Leave": the department manager records that a team member was away
// on a reporting date, so no report is expected of them and no warning is
// raised for it.
//
// The manager decides this themselves — no HR step. They are the person who
// knows whether someone turned up, and sending it to HR for approval would
// mean the 9pm sweep warns the employee while the request is still queued.
// HR still SEES it: the marking is stored as an approved leave claim with
// the manager as its reviewer, so it appears in HR's leave log settled
// rather than as a to-do. See markLeaveByManager.
//
// What keeps this from being a quiet way to erase a team's absences:
//   * Only for employees in a department the manager actually manages, the
//     same gate as File for Them (resolveEmployeeAccess.canFileForThem).
//   * A reason is required, and the employee is told, by name, who marked it.
//   * Audited, and any warning it waives keeps its row with the reason
//     attached rather than being deleted.
export async function POST(request: NextRequest) {
  const guard = await guardDailyReport(request, 'team-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  if (!(await canAccessTeamDashboard(viewer))) {
    return NextResponse.json({ error: 'Forbidden — you do not manage a department.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const employeeId = (body as { employeeId?: unknown })?.employeeId;
  if (typeof employeeId !== 'string' || !isUuidLike(employeeId)) {
    return NextResponse.json({ error: 'A valid employeeId is required.' }, { status: 400 });
  }

  const validation = validateManagerLeaveMark(
    {
      reportDate: typeof (body as { reportDate?: unknown })?.reportDate === 'string' ? (body as { reportDate: string }).reportDate : '',
      reason: typeof (body as { reason?: unknown })?.reason === 'string' ? (body as { reason: string }).reason : ''
    },
    istDate(new Date())
  );
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  try {
    const access = await resolveEmployeeAccess(viewer, employeeId);
    if (access.isSelf) {
      // A manager excusing their own missed report, decided by themselves,
      // is not a manager action — it is the thing HR review exists for.
      return NextResponse.json(
        { error: 'You cannot mark your own leave here — raise a leave claim so HR can decide it.' },
        { status: 400 }
      );
    }
    if (!access.canFileForThem) {
      return NextResponse.json({ error: 'Forbidden — this employee is not in a department you manage.' }, { status: 403 });
    }

    const employee = await resolveEmployeeIdentity(employeeId);
    if (!employee) return NextResponse.json({ error: 'That employee was not found.' }, { status: 404 });

    const { claim, waivedWarningId } = await markLeaveByManager({
      employeeId: employee.id,
      departmentId: employee.departmentId || null,
      reportDate: validation.reportDate,
      reason: validation.reason,
      markedById: viewer.userId
    });

    // The employee is always told. Being marked absent is a statement about
    // you on your own record; finding out from a compliance report later is
    // not acceptable.
    await notifyUsers([employee.username], {
      title: `${viewer.name || viewer.username} marked you on leave for ${validation.reportDate}`,
      body: waivedWarningId
        ? `No daily report is expected from you for ${validation.reportDate}, and the missed-report warning for that date has been waived. Reason: ${validation.reason}`
        : `No daily report is expected from you for ${validation.reportDate}. Reason: ${validation.reason}`,
      type: 'daily_report_leave_marked',
      entityType: 'daily_report_leave_claim',
      entityId: claim.id
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_leave_claim',
      entityId: claim.id,
      action: `Marked ${employee.name || employee.username} on leave for ${validation.reportDate}`,
      previousStatus: '',
      newStatus: 'APPROVED',
      remarks: waivedWarningId ? `${validation.reason} (waived an existing warning)` : validation.reason,
      ip: getClientIp(request)
    });

    return NextResponse.json({ leave_claim: claim, waived_warning: !!waivedWarningId }, { status: 201 });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
