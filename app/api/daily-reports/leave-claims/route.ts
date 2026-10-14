import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readDateParam } from '@/lib/dailyReportApi';
import { createClaim, listClaimsForDate, listClaims } from '@/lib/dailyReportLeaveClaimStore';
import { resolveEmployeeIdentity } from '@/lib/dailyReportService';
import { notifyLeaveClaimRaised } from '@/lib/dailyReportNotify';
import { resolveHrRecipients } from '@/lib/dailyReportAccess';
import { getDeadlinePolicy } from '@/lib/dailyReportConfigStore';
import { isIsoDate, scheduleFor } from '@/lib/dailyReportTime';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// The employee's own leave claims — the "I Was on Leave" action.
//
// Addressed by reporting DATE rather than by report id, which is a
// deliberate departure from the route sketch in the brief
// (/api/daily-reports/:id/leave-claim). The reason is that the case this
// exists for is a date with NO report: somebody who was away never created
// one, so there is no id to hang the claim off. Keying on the date means the
// action works on exactly the days it is needed for.

// GET ?date=YYYY-MM-DD — every claim for one of the caller's dates
// (including rejected ones, so they can see why). Without a date, their
// recent claims.
export async function GET(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  try {
    const date = readDateParam(request);
    if (date) return NextResponse.json({ claims: await listClaimsForDate(viewer.userId, date) });
    // Always scoped to the caller — a leave claim's reason is personal, and
    // HR reads other people's through the HR endpoint.
    const { claims } = await listClaims({ employeeIds: [viewer.userId], pageSize: 50 });
    return NextResponse.json({ claims });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}

// POST — raise a claim for one reporting date.
//
// The claim becomes PENDING, which immediately excludes that date from NEW
// reminders and warnings (see loadLeaveCoveredKeys), so nobody is nagged
// while HR is deciding. Any warning already recorded for the date stays put
// until HR actually approves — the approval is what waives it, not the
// request.
export async function POST(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  const body = await request.json().catch(() => null);
  const reportDate = (body as { reportDate?: unknown })?.reportDate;
  if (typeof reportDate !== 'string' || !isIsoDate(reportDate)) {
    return NextResponse.json({ error: 'A valid reporting date (YYYY-MM-DD) is required.' }, { status: 400 });
  }
  const reason = typeof (body as { reason?: unknown })?.reason === 'string' ? ((body as { reason: string }).reason as string) : '';
  // Attachments are references into the app's EXISTING upload pipeline
  // (POST /api/uploads → { name, path }), not a new storage mechanism — the
  // client uploads first and posts the resulting paths here.
  const rawAttachments = (body as { attachments?: unknown })?.attachments;
  const attachments = Array.isArray(rawAttachments)
    ? rawAttachments
        .filter((a): a is { name: string; path: string; size?: number } => !!a && typeof a === 'object' && typeof (a as { path?: unknown }).path === 'string')
        .slice(0, 5)
        .map((a) => ({ name: String(a.name ?? 'attachment'), path: a.path, size: typeof a.size === 'number' ? a.size : undefined }))
    : [];

  try {
    const employee = await resolveEmployeeIdentity(viewer.userId);
    if (!employee) return NextResponse.json({ error: 'Your employee record could not be found.' }, { status: 404 });

    const claim = await createClaim({
      employeeId: employee.id,
      departmentId: employee.departmentId || null,
      reportDate,
      reason,
      attachments
    });

    const policy = await getDeadlinePolicy();
    await notifyLeaveClaimRaised({
      claimId: claim.id,
      employeeId: employee.id,
      employeeName: employee.name,
      departmentName: employee.departmentName,
      reportDate,
      reason: claim.reason,
      deadlineAt: scheduleFor(reportDate, policy).deadlineAt,
      hrRecipients: await resolveHrRecipients()
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_leave_claim',
      entityId: claim.id,
      action: `Leave claimed for daily report date ${reportDate}`,
      previousStatus: '',
      newStatus: 'PENDING',
      remarks: claim.reason.slice(0, 200),
      ip: getClientIp(request)
    });

    return NextResponse.json(claim, { status: 201 });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
