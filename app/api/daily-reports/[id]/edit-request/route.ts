import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { resolveEmployeeAccess, resolveReportManagers } from '@/lib/dailyReportAccess';
import { findReportById, SUBMITTED_STATUSES } from '@/lib/dailyReportStore';
import { findAssignmentByDepartmentId } from '@/lib/dailyReportTemplateStore';
import {
  createEditRequest,
  findLiveEditRequest,
  withdrawEditRequest
} from '@/lib/dailyReportEditRequestStore';
import { notifyEditRequestRaised } from '@/lib/dailyReportNotify';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// "I need to change a report I have already filed."
//
// Submitting is terminal, so this is the only way back in. Addressed by REPORT
// ID rather than by date — unlike the leave claim next door, which is keyed on
// a date precisely because the case it exists for is a date with no report.
// Here there definitionally is one.
//
// The approver is the employee's DEPARTMENT MANAGER, not HR. That is why this
// route and its decision sibling live outside /hr/.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const reason = typeof (body as { reason?: unknown })?.reason === 'string' ? (body as { reason: string }).reason : '';

  try {
    const report = await findReportById(id);
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    const access = await resolveEmployeeAccess(viewer, report.employee_id);
    // Only the person whose report it is asks for permission to change it. A
    // manager who wants it changed can already change it — by approving.
    if (!access.isSelf) {
      return NextResponse.json({ error: 'Only the person who filed a report can ask to edit it.' }, { status: 403 });
    }
    if (!SUBMITTED_STATUSES.includes(report.submission_status)) {
      return NextResponse.json({ error: 'This report is still a draft — you can edit it directly.' }, { status: 400 });
    }

    const created = await createEditRequest({
      reportId: id,
      employeeId: report.employee_id,
      departmentId: report.department_id || null,
      reportDate: report.report_date,
      reason
    });

    // Department Master is read live, so a change of manager takes effect
    // without anything being re-saved — the same resolution /submit uses to
    // decide who hears about a filing.
    const assignment = await findAssignmentByDepartmentId(report.department_id);
    const managers = await resolveReportManagers(report.department_name, assignment?.extraManagerIds ?? []);
    await notifyEditRequestRaised({
      requestId: created.id,
      employeeId: report.employee_id,
      employeeName: report.employee_name,
      departmentName: report.department_name,
      reportDate: report.report_date,
      reason: created.reason,
      managers
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_edit_request',
      entityId: created.id,
      action: `Asked to edit the daily report for ${report.report_date}`,
      previousStatus: '',
      newStatus: 'PENDING',
      remarks: created.reason.slice(0, 240),
      ip: getClientIp(request)
    });

    return NextResponse.json({ edit_request: created }, { status: 201 });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}

/** The live request for this report, if any — what the page shows as status. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  try {
    const { id } = await params;
    const report = await findReportById(id);
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    const access = await resolveEmployeeAccess(viewer, report.employee_id);
    if (!access.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ edit_request: (await findLiveEditRequest(id)) ?? null });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}

/** Withdraw one's own still-undecided request. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  try {
    const { id } = await params;
    const live = await findLiveEditRequest(id);
    if (!live) return NextResponse.json({ error: 'There is nothing to withdraw.' }, { status: 404 });
    if (live.employee_id !== viewer.userId) {
      return NextResponse.json({ error: 'Only the person who asked can withdraw it.' }, { status: 403 });
    }
    const done = await withdrawEditRequest(live.id, viewer.userId);
    if (!done) return NextResponse.json({ error: 'That request has already been decided.' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
