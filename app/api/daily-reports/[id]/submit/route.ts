import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { findReportById, submitReportById } from '@/lib/dailyReportStore';
import { resolveEmployeeAccess, resolveReportManagers } from '@/lib/dailyReportAccess';
import { findAssignmentByDepartmentId } from '@/lib/dailyReportTemplateStore';
import { notifyReportSubmitted } from '@/lib/dailyReportNotify';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// POST /api/daily-reports/:id/submit
//
// Submits what is already saved. Carries no payload on purpose: the employee
// is confirming the draft they can see, and accepting a body here would open
// a window for the submitted content to differ from what was on screen.
//
// Safe to call repeatedly. The second call validates and returns the same
// report, leaves submitted_at exactly as it was, and sends nothing — the
// 'SUBMITTED' row in the notification ledger is already there.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;
  const { id } = await params;

  try {
    const existing = await findReportById(id);
    if (!existing) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    const access = await resolveEmployeeAccess(viewer, existing.employee_id);
    if (!access.isSelf && !access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { report, justSubmitted } = await submitReportById(id, viewer.userId, !access.isSelf);

    if (justSubmitted) {
      const assignment = await findAssignmentByDepartmentId(report.department_id);
      const managers = await resolveReportManagers(report.department_name, assignment?.extraManagerIds ?? []);
      await notifyReportSubmitted({
        reportId: report.id,
        employeeId: report.employee_id,
        employeeName: report.employee_name,
        departmentName: report.department_name,
        reportDate: report.report_date,
        submittedAt: new Date(report.submitted_at),
        deadlineAt: new Date(report.deadline_at),
        late: report.is_late,
        entryCount: report.entries.length,
        managers
      });
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'daily_report',
        entityId: report.id,
        action: access.isSelf
          ? `Daily report submitted for ${report.report_date}`
          : `Daily report filed for ${report.employee_name} (${report.report_date})`,
        previousStatus: 'DRAFT',
        newStatus: report.submission_status,
        remarks: report.is_late ? 'Submitted after the deadline' : '',
        ip: getClientIp(request)
      });
    }

    return NextResponse.json({ report, alreadySubmitted: !justSubmitted });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
