import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readPayload } from '@/lib/dailyReportApi';
import { resolveEmployeeIdentity } from '@/lib/dailyReportService';
import { saveReport } from '@/lib/dailyReportStore';
import { notifyReportSubmitted } from '@/lib/dailyReportNotify';
import { resolveReportManagers } from '@/lib/dailyReportAccess';
import { findAssignmentByDepartmentId } from '@/lib/dailyReportTemplateStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { isIsoDate } from '@/lib/dailyReportTime';

// POST /api/daily-reports
//
// Create or update the caller's OWN report for a date, as a draft or as a
// submission. One endpoint for both because they are the same write with one
// flag's difference, and splitting them would have meant two copies of the
// create-or-update, validation and revision logic.
//
// `mode` is what separates saving from submitting — the brief requires them
// to be separate ACTIONS, not separate endpoints, and a client that forgets
// to send it gets a draft, which is the harmless default.
export async function POST(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const reportDate = (body as { reportDate?: unknown }).reportDate;
  if (typeof reportDate !== 'string' || !isIsoDate(reportDate)) {
    return NextResponse.json({ error: 'A valid reporting date (YYYY-MM-DD) is required.' }, { status: 400 });
  }
  const mode = (body as { mode?: unknown }).mode === 'submit' ? 'submit' : 'draft';

  try {
    const employee = await resolveEmployeeIdentity(viewer.userId);
    if (!employee?.departmentId) {
      return NextResponse.json({ error: 'Your account has no department assigned, so a report cannot be filed.' }, { status: 409 });
    }

    const { report, justSubmitted } = await saveReport({
      employeeId: employee.id,
      departmentId: employee.departmentId,
      reportDate,
      payload: readPayload(body),
      mode,
      actorId: viewer.userId,
      onBehalf: false
    });

    // Only on the transition into submitted, and only after the write has
    // committed — a notification for a report that failed to save would be
    // worse than none.
    if (justSubmitted) {
      const assignment = await findAssignmentByDepartmentId(employee.departmentId);
      const managers = await resolveReportManagers(employee.departmentName, assignment?.extraManagerIds ?? []);
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
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'daily_report',
        entityId: report.id,
        action: `Daily report submitted for ${reportDate}`,
        previousStatus: 'DRAFT',
        newStatus: report.submission_status,
        remarks: report.is_late ? 'Submitted after the deadline' : '',
        ip: getClientIp(request)
      });
    }

    return NextResponse.json(report, { status: justSubmitted ? 200 : 201 });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
