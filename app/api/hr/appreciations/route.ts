import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { getClientIp } from '@/lib/requestIp';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { findUserById } from '@/lib/userStore';
import { listDepartmentManagers, findHrManagers } from '@/lib/departmentStore';
import { isAppreciationDecider, pickableEmployees } from '@/lib/appreciationAccess';
import {
  AppreciationsUnavailableError,
  createAppreciation,
  listAllAppreciations,
  listAppreciationsByNominator,
  validateTaskFields
} from '@/lib/appreciationStore';

// Employee Appreciation — list + submit.
//   GET  HR Manager / admin: every appreciation; managers: the ones they submitted.
//   POST managers / department heads / admin: nominate an employee in scope.

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function unavailable(error: unknown) {
  return error instanceof AppreciationsUnavailableError
    ? NextResponse.json({ error: error.message }, { status: 503 })
    : null;
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const [isDecider, pickable] = await Promise.all([isAppreciationDecider(viewer), pickableEmployees(viewer)]);
    const canSubmit = pickable.length > 0;
    if (!isDecider && !canSubmit) return NextResponse.json({ error: 'Only managers, department heads and HR can use Employee Appreciation' }, { status: 403 });
    const rows = isDecider ? await listAllAppreciations() : await listAppreciationsByNominator(viewer.userId);
    // The nominating manager may edit/delete their own submission ONLY while
    // it is still awaiting HR — once decided, the record is HR's history to
    // keep, not the manager's to rewrite. Computed here (not re-derived by
    // the client from nominated_by, which the client has no reliable
    // identity to compare against anyway) so the UI and the enforcement in
    // [id]/route.ts can never disagree about who sees edit controls.
    const withEditFlag = rows.map((r) => ({ ...r, can_edit: r.nominated_by === viewer.userId && r.status === 'pending' }));
    return NextResponse.json({ rows: withEditFlag, isDecider, canSubmit });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const employeeId = str(body?.employeeId, 64);
  const validated = validateTaskFields(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const { taskGivenDate, taskDeadlineDate, taskCompletionDate, savings, description, attachmentUrl } = validated.value;

  if (!employeeId) return NextResponse.json({ error: 'Pick the employee you are appreciating' }, { status: 400 });

  try {
    const pickable = await pickableEmployees(viewer);
    if (!pickable.length) return NextResponse.json({ error: 'Only managers, department heads and admins can submit appreciations' }, { status: 403 });
    const employee = pickable.find((e) => e.id === employeeId);
    if (!employee) return NextResponse.json({ error: 'You can only appreciate people in your own team or department' }, { status: 403 });

    const me = await findUserById(viewer.userId);
    const created = await createAppreciation({
      employeeId,
      employeeName: employee.name,
      employeeDepartment: employee.department,
      employeeDesignation: employee.designation,
      nominatedBy: viewer.userId,
      nominatedByName: me?.name || viewer.username,
      taskGivenDate,
      taskDeadlineDate,
      taskCompletionDate,
      savings,
      description,
      attachmentUrl
    });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'employee_appreciation', entityId: created.id,
      action: 'appreciation_submit', previousStatus: '', newStatus: 'pending',
      remarks: `${employee.name} — task completed ${taskCompletionDate}`, ip: getClientIp(request)
    });

    const hrManagers = findHrManagers(await listDepartmentManagers()).map((m) => m.username).filter((u) => u !== viewer.username);
    await notifyUsers(hrManagers, {
      title: 'Employee appreciation awaiting your review',
      body: `${created.nominated_by_name} appreciated ${employee.name}.`,
      type: 'appreciation_submitted',
      entityType: 'employee_appreciation',
      entityId: created.id
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}
