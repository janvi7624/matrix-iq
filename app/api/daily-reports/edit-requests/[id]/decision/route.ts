import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { decideEditRequest, findEditRequestById } from '@/lib/dailyReportEditRequestStore';
import { notifyEditRequestDecision } from '@/lib/dailyReportNotify';
import { findUserById } from '@/lib/userStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// The department manager's decision on a request to edit a filed report.
//
// Deliberately NOT under /hr/: the approver here is the employee's own
// department manager, not HR. The authority check reads canEdit, which comes
// from manageDepartmentIds — NOT canView, which comes from departmentIds and
// is company-wide for HR. Using the wrong one would hand every HR account the
// power to approve edits to every report in the company, which is the exact
// opposite of what was asked for. This is the easiest mistake to make here.
//
// Whether the request is still decidable is enforced inside decideEditRequest's
// conditional UPDATE rather than by a read here, so two managers pressing
// Approve at the same moment cannot both win.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const decision = (body as { decision?: unknown })?.decision;
  const reason = typeof (body as { reason?: unknown })?.reason === 'string' ? (body as { reason: string }).reason : '';

  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return NextResponse.json({ error: 'Decision must be APPROVED or REJECTED.' }, { status: 400 });
  }

  try {
    const existing = await findEditRequestById(id);
    if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    // Re-resolved from the session, never read from the body.
    const access = await resolveEmployeeAccess(viewer, existing.employee_id);
    if (!access.canEdit || access.isSelf) {
      return NextResponse.json(
        { error: 'Only this employee’s department manager can decide this.' },
        { status: 403 }
      );
    }

    const decided = await decideEditRequest(id, decision, viewer.userId, reason);

    const employee = await findUserById(decided.employee_id);
    if (employee) {
      await notifyEditRequestDecision({
        requestId: decided.id,
        employee: { username: employee.username, name: employee.name || employee.username, email: employee.email || '' },
        employeeName: decided.employee_name,
        departmentName: decided.department_name,
        reportDate: decided.report_date,
        decision,
        decisionReason: decided.decision_reason,
        grantExpiresAt: decided.grant_expires_at
      });
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_edit_request',
      entityId: decided.id,
      action: `${decision === 'APPROVED' ? 'Allowed' : 'Refused'} an edit to the daily report for ${decided.report_date}`,
      previousStatus: 'PENDING',
      newStatus: decision,
      remarks: [decided.employee_name, decided.decision_reason].filter(Boolean).join(' · ').slice(0, 240),
      ip: getClientIp(request)
    });

    return NextResponse.json({ edit_request: decided });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
