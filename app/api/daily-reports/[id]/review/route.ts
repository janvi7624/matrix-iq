import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { findReportById, reviewReport } from '@/lib/dailyReportStore';
import { resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// POST /api/daily-reports/:id/review
//
// A manager's verdict on a submitted report: REVIEWED, or CHANGES_REQUESTED
// with a note saying what needs changing.
//
// Review status is kept entirely separate from submission status and is
// never a gate — a report is filed the moment it is submitted, whether or
// not anyone reviews it. The brief is explicit that mandatory manager
// approval must not be introduced unless it is configured, so there is no
// path here that can un-submit a report or make a submission conditional.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'team-daily-reports');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const status = (body as { status?: unknown })?.status;
  if (status !== 'REVIEWED' && status !== 'CHANGES_REQUESTED') {
    return NextResponse.json({ error: 'status must be REVIEWED or CHANGES_REQUESTED.' }, { status: 400 });
  }
  const note = typeof (body as { note?: unknown })?.note === 'string' ? ((body as { note: string }).note as string) : '';

  try {
    const existing = await findReportById(id);
    if (!existing) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    const access = await resolveEmployeeAccess(viewer, existing.employee_id);
    // Reviewing your own report would make the status meaningless.
    if (access.isSelf) return NextResponse.json({ error: 'You cannot review your own report.' }, { status: 403 });
    if (!access.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const report = await reviewReport(id, status, note, viewer.userId);

    await notifyUsers([report.employee_username], {
      title: status === 'REVIEWED' ? `Daily report reviewed — ${report.report_date}` : `Changes requested on your ${report.report_date} report`,
      body:
        status === 'REVIEWED'
          ? `${viewer.name} reviewed your daily report for ${report.report_date}.`
          : `${viewer.name} asked for changes to your ${report.report_date} report: ${note.trim()}`,
      type: 'daily_report_review',
      entityType: 'daily_report',
      entityId: report.id
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report',
      entityId: report.id,
      action: `Reviewed ${report.employee_name}'s daily report for ${report.report_date}`,
      previousStatus: existing.review_status,
      newStatus: status,
      remarks: note.trim(),
      ip: getClientIp(request)
    });

    return NextResponse.json(report);
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
