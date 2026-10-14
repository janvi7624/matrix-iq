import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { decideClaim, findClaimById } from '@/lib/dailyReportLeaveClaimStore';
import { canAccessHrReview } from '@/lib/dailyReportAccess';
import { getDailyReportConfig, getDeadlinePolicy } from '@/lib/dailyReportConfigStore';
import { notifyLeaveDecision } from '@/lib/dailyReportNotify';
import { findUserById } from '@/lib/userStore';
import { scheduleFor } from '@/lib/dailyReportTime';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// POST /api/daily-reports/hr/leave-claims/:id/decision
//
// HR approves or rejects one claim. Both outcomes require a reason — a
// decision somebody may later be asked to justify should not be
// recordable without one.
//
// What each outcome does to the warning ledger is decideClaim's business
// (approval waives an already-recorded warning; rejection follows the
// configured leave_rejection_policy rather than silently doing something).
// The outcome is reported back and told to the employee, so the rule is
// visible rather than implicit.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'hr-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;
  if (!(await canAccessHrReview(viewer))) {
    return NextResponse.json({ error: 'Forbidden — HR review is limited to HR managers and administrators.' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const decision = (body as { decision?: unknown })?.decision;
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return NextResponse.json({ error: 'decision must be APPROVED or REJECTED.' }, { status: 400 });
  }
  const reason = typeof (body as { reason?: unknown })?.reason === 'string' ? ((body as { reason: string }).reason as string) : '';

  try {
    const before = await findClaimById(id);
    if (!before) return NextResponse.json({ error: 'Leave claim not found' }, { status: 404 });

    const config = await getDailyReportConfig();
    const result = await decideClaim(id, decision, viewer.userId, reason, config.leave_rejection_policy);

    const employee = await findUserById(result.claim.employee_id);
    if (employee) {
      const policy = await getDeadlinePolicy();
      await notifyLeaveDecision({
        claimId: result.claim.id,
        employee: { username: employee.username, name: employee.name || employee.username, email: employee.email || '' },
        reportDate: result.claim.report_date,
        decision,
        decisionReason: result.claim.decision_reason,
        rejectionOutcome: result.rejectionOutcome,
        deadlineAt: scheduleFor(result.claim.report_date, policy).deadlineAt
      });
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_leave_claim',
      entityId: result.claim.id,
      action: `Leave claim ${decision.toLowerCase()} for ${result.claim.employee_name} (${result.claim.report_date})`,
      previousStatus: 'PENDING',
      newStatus: decision,
      remarks: [
        result.claim.decision_reason,
        result.waivedWarningId ? 'Existing missed-report warning waived' : '',
        result.rejectionOutcome ? `Rejection policy: ${result.rejectionOutcome}` : ''
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 240),
      ip: getClientIp(request)
    });

    return NextResponse.json(result);
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
