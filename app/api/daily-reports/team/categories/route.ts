import { NextRequest, NextResponse } from 'next/server';
import { dailyReportErrorResponse, guardDailyReport, isGuardFailure } from '@/lib/dailyReportApi';
import { canAccessTeamDashboard, resolveDailyReportScope } from '@/lib/dailyReportAccess';
import {
  CategoryEditError,
  CategoryGroup,
  describeCategoryGroups,
  overridesFromGroups
} from '@/lib/dailyReportCategoryFields';
import {
  findAssignmentByDepartmentId,
  InvalidTemplateAssignmentError,
  resolveTemplateForDepartment,
  updateTemplateAssignment
} from '@/lib/dailyReportTemplateStore';
import { BUILT_IN_TEMPLATES } from '@/lib/dailyReportTemplates';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// The task dropdowns a manager may edit for their own department — the
// Category and its dependent Sub-category.
//
// Lives here rather than under /api/admin/daily-report-config because that
// page is superadmin+admin only, and the people who actually know what the
// categories should say are the department managers.
//
// TWO DIFFERENT SCOPES, deliberately:
//   reading  -> scope.departmentIds       (HR reads every department)
//   writing  -> scope.manageDepartmentIds (HR manages only its own)
// Collapsing them would hand HR edit rights over every department's form as
// a side effect of the company-wide visibility granted earlier.

async function loadScope(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return { failure: guard.response };
  const { viewer } = guard;
  if (!(await canAccessTeamDashboard(viewer))) {
    return { failure: NextResponse.json({ error: 'Forbidden — you do not manage a department.' }, { status: 403 }) };
  }
  return { viewer, scope: await resolveDailyReportScope(viewer) };
}

export async function GET(request: NextRequest) {
  const loaded = await loadScope(request);
  if (loaded.failure) return loaded.failure;
  const { scope } = loaded;

  const requested = request.nextUrl.searchParams.get('departmentId') || '';
  // Default to a department the viewer can actually EDIT, so the screen does
  // not open read-only for an HR manager who has one of their own.
  const departmentId =
    requested && scope.departmentIds.includes(requested)
      ? requested
      : scope.manageDepartmentIds[0] || scope.departmentIds[0] || '';

  if (!departmentId) return NextResponse.json({ error: 'You do not manage a department.' }, { status: 403 });

  try {
    const resolved = await resolveTemplateForDepartment(departmentId);
    const assignment = await findAssignmentByDepartmentId(departmentId);
    // Described from the BASE template plus overrides — a resolved template
    // cannot tell a manager-added sub-level apart from a built-in one, and
    // only the first may be switched off.
    const baseTemplate = BUILT_IN_TEMPLATES[resolved.templateKey] ?? resolved.template;
    return NextResponse.json({
      department_id: departmentId,
      template_key: resolved.templateKey,
      template_label: resolved.template.label,
      configured: resolved.configured,
      can_edit: scope.manageDepartmentIds.includes(departmentId),
      groups: describeCategoryGroups(baseTemplate, assignment?.overrides ?? {}),
      departments: scope.departments.map((d) => ({
        id: d.id,
        name: d.name,
        can_edit: scope.manageDepartmentIds.includes(d.id)
      }))
    });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const loaded = await loadScope(request);
  if (loaded.failure) return loaded.failure;
  const { viewer, scope } = loaded;

  const body = await request.json().catch(() => null);
  const departmentId = typeof body?.departmentId === 'string' ? body.departmentId : '';
  // The write gate. Checked against manageDepartmentIds, never
  // departmentIds — see the note at the top of this file.
  if (!departmentId || !scope.manageDepartmentIds.includes(departmentId)) {
    return NextResponse.json({ error: 'You can only change the format of a department you manage.' }, { status: 403 });
  }
  if (!Array.isArray(body?.groups)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const resolved = await resolveTemplateForDepartment(departmentId);
    if (!resolved.configured) {
      return NextResponse.json({ error: 'This department has no report format assigned yet.' }, { status: 400 });
    }
    const assignment = await findAssignmentByDepartmentId(departmentId);

    // Built from the template's OWN groups plus the submitted catalogue, so
    // a payload naming a field this format does not have is refused rather
    // than written.
    const baseTemplate = BUILT_IN_TEMPLATES[resolved.templateKey] ?? resolved.template;
    const overrides = overridesFromGroups(baseTemplate, body.groups as CategoryGroup[], assignment?.overrides ?? {});
    await updateTemplateAssignment(departmentId, { overrides }, viewer.userId);

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_config',
      entityId: departmentId,
      action: 'Daily report task categories updated',
      previousStatus: '',
      newStatus: '',
      remarks: (body.groups as CategoryGroup[]).map((g) => `${g.parentLabel}: ${Object.keys(g.catalogue).length}`).join('; '),
      ip: getClientIp(request)
    });

    const saved = await findAssignmentByDepartmentId(departmentId);
    return NextResponse.json({ ok: true, groups: describeCategoryGroups(baseTemplate, saved?.overrides ?? {}) });
  } catch (error) {
    if (error instanceof CategoryEditError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof InvalidTemplateAssignmentError) return NextResponse.json({ error: error.message }, { status: 400 });
    return dailyReportErrorResponse(error);
  }
}
