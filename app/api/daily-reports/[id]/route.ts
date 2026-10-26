import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure, readPayload } from '@/lib/dailyReportApi';
import { findReportById, listRevisions, saveReport, SUBMITTED_STATUSES } from '@/lib/dailyReportStore';
import { resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { findLiveEditRequest } from '@/lib/dailyReportEditRequestStore';
import { resolveTemplateForStoredReport } from '@/lib/dailyReportTemplateStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// One report by id.
//
// The draft-privacy rule is enforced here and not only in the views: a
// DRAFT is readable by its owner alone. A manager — or an admin — asking for
// a draft by id gets a 404, not a 403, because confirming "there is a draft
// here you may not read" is itself a disclosure about what a colleague is
// part-way through writing.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;
  const { id } = await params;

  try {
    const report = await findReportById(id);
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    const access = await resolveEmployeeAccess(viewer, report.employee_id);
    const isDraft = !SUBMITTED_STATUSES.includes(report.submission_status);
    if (isDraft && !access.isSelf) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if (!access.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    return NextResponse.json({
      report,
      // The template travels with the report so the viewer can render a
      // format that is no longer the department's current one.
      template: await resolveTemplateForStoredReport(report.department_id, report.template_key),
      revisions: await listRevisions(report.id),
      can_edit: access.canEdit
    });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}

// PATCH — edit an existing report. Used by the employee on their own report
// and by an authorized manager on a team member's submitted report.
//
// Submitting is terminal. A SUBMITTED report can only be edited when the
// employee holds an APPROVED, unspent permission from their department
// manager (daily_report_edit_requests) — which this route looks up and hands
// to saveReport, where the grant is actually spent inside the transaction.
// An edit still never moves the original submission timestamp; saveReport is
// the single place that invariant lives.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const payload = readPayload(body);
  if (!payload) return NextResponse.json({ error: 'Nothing to update — send header, entries, or matrix.' }, { status: 400 });

  try {
    const existing = await findReportById(id);
    if (!existing) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    const access = await resolveEmployeeAccess(viewer, existing.employee_id);
    const isDraft = !SUBMITTED_STATUSES.includes(existing.submission_status);
    // Same reasoning as GET: somebody else's draft does not exist as far as
    // this endpoint is concerned.
    if (isDraft && !access.isSelf) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const mode = (body as { mode?: unknown })?.mode === 'submit' ? 'submit' : isDraft ? 'draft' : 'submit';

    // A filed report needs a live, approved, unspent grant. Looked up rather
    // than assumed, and only ever CONSUMED inside saveReport's transaction —
    // checking here and spending there is deliberate, so a save that fails
    // validation does not burn the employee's one permission.
    const grant = isDraft ? undefined : await findLiveEditRequest(id);

    // The approver does not have to ask themselves for permission.
    //
    // The rule is that an EMPLOYEE cannot change a report they have filed —
    // they ask their department manager. That manager (and an admin, who
    // outranks them) IS the authority the lock defers to, so requiring them
    // to raise a request addressed to themselves would be circular, and it
    // left them with an Edit button that only ever failed on save after they
    // had retyped the content.
    //
    // canEdit && !isSelf is exactly "a department manager of this employee,
    // or an admin" — it reads manageDepartmentIds, so HR's company-wide
    // READ access does not qualify. Every such edit is still recorded as a
    // revision and in the audit log below.
    const isApprover = access.canEdit && !access.isSelf;
    const editAuthority = isDraft
      ? undefined
      : isApprover
        ? ('approver' as const)
        : grant?.status === 'APPROVED'
          ? ('grant' as const)
          : undefined;

    const { report, wasEdited } = await saveReport({
      employeeId: existing.employee_id,
      departmentId: existing.department_id,
      reportDate: existing.report_date,
      payload,
      mode,
      actorId: viewer.userId,
      onBehalf: !access.isSelf,
      editAuthority
    });

    if (!access.isSelf) {
      // A manager editing somebody else's report is the kind of thing that
      // has to be visible in the shared audit log, not just in the report's
      // own revision list.
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'daily_report',
        entityId: report.id,
        action: `Edited ${report.employee_name}'s daily report for ${report.report_date}`,
        previousStatus: existing.submission_status,
        newStatus: report.submission_status,
        ip: getClientIp(request)
      });
    } else if (wasEdited) {
      // Editing your OWN already-submitted report. Still audited, for the
      // same reason: the edit mails nobody and rewrites the stored rows in
      // place, so without this row the only trace that the filed content
      // changed is a revision entry — and the content it replaced is gone
      // from daily_report_entries entirely.
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'daily_report',
        entityId: report.id,
        action: `Daily report edited after submission for ${report.report_date}`,
        previousStatus: existing.submission_status,
        newStatus: report.submission_status,
        ip: getClientIp(request)
      });
    }

    return NextResponse.json(report);
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
