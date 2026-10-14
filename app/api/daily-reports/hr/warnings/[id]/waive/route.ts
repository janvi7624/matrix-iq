import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { findWarningById, reinstateWarning, waiveWarning } from '@/lib/dailyReportWarningStore';
import { canAccessHrReview } from '@/lib/dailyReportAccess';
import { notifyUsers } from '@/lib/notificationStore';
import { findUserById } from '@/lib/userStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// POST /api/daily-reports/hr/warnings/:id/waive
//
// Waives one missed-report warning, with a mandatory reason, or reinstates
// one that was waived in error (`action: 'reinstate'`).
//
// A warning is never deleted. Waiving flips its status, which removes it
// from the active count that feeds the HR threshold while leaving the record
// visible, attributed and explained — so the month's history stays honest
// and the employee can see both that it happened and that it was waived.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'hr-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;
  if (!(await canAccessHrReview(viewer))) {
    return NextResponse.json({ error: 'Forbidden — HR review is limited to HR managers and administrators.' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const reason = typeof (body as { reason?: unknown })?.reason === 'string' ? ((body as { reason: string }).reason as string) : '';
  const action = (body as { action?: unknown })?.action === 'reinstate' ? 'reinstate' : 'waive';

  try {
    const before = await findWarningById(id);
    if (!before) return NextResponse.json({ error: 'Warning not found' }, { status: 404 });

    const warning = action === 'reinstate' ? await reinstateWarning(id, reason) : await waiveWarning(id, viewer.userId, reason);

    const employee = await findUserById(warning.employee_id);
    if (employee) {
      await notifyUsers([employee.username], {
        title:
          action === 'reinstate'
            ? `Missed-report warning reinstated — ${warning.report_date}`
            : `Missed-report warning waived — ${warning.report_date}`,
        body:
          action === 'reinstate'
            ? `${viewer.name} reinstated the warning for ${warning.report_date}. ${reason.trim()}`
            : `${viewer.name} waived your missed-report warning for ${warning.report_date}. ${warning.waiver_reason}`,
        type: 'daily_report_warning_waived',
        entityType: 'daily_report_warning',
        entityId: warning.id
      });
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_warning',
      entityId: warning.id,
      action: `${action === 'reinstate' ? 'Reinstated' : 'Waived'} missed-report warning for ${warning.employee_name} (${warning.report_date})`,
      previousStatus: before.status,
      newStatus: warning.status,
      remarks: (action === 'reinstate' ? reason : warning.waiver_reason).slice(0, 240),
      ip: getClientIp(request)
    });

    return NextResponse.json(warning);
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
