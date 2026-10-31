import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { canAccessHrReview } from '@/lib/dailyReportAccess';
import { acknowledgeEscalation } from '@/lib/dailyReportWarningStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// POST /api/daily-reports/hr/escalations/:id/acknowledge
//
// "We have dealt with this." Records what HR did about an escalation and
// stops the two-day reminders to the HR manager.
//
// Separate from waiving a warning on purpose. The right response to four
// genuinely missed reports is usually a conversation, not an exemption — so
// requiring a waiver to clear the item would have pushed HR into waiving
// warnings they meant to stand by, which is the opposite of what the
// threshold is for. The note IS the action, and it is mandatory: an
// acknowledgement with nothing in it would clear the queue while recording
// nothing, which is worse than leaving it pending.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'hr-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  if (!(await canAccessHrReview(viewer))) {
    return NextResponse.json({ error: 'Forbidden — HR review is limited to HR managers and administrators.' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const note = typeof (body as { note?: unknown })?.note === 'string' ? (body as { note: string }).note : '';

  try {
    const escalation = await acknowledgeEscalation(id, viewer.userId, note);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      // 'daily_report_warning', not a new 'daily_report_escalation' type:
      // an escalation is an event in the warning ledger, and every audit
      // entity_type also needs a resolver entry to render a link for it.
      entityType: 'daily_report_warning',
      entityId: id,
      action: `Recorded HR action on the ${escalation.monthKey} escalation`,
      previousStatus: 'pending',
      newStatus: 'actioned',
      remarks: escalation.actionNote.slice(0, 240),
      ip: getClientIp(request)
    });

    return NextResponse.json({ escalation });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
