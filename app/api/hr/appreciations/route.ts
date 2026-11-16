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
  AppreciationSavings,
  EMPTY_SAVINGS,
  TIME_SAVINGS_UNITS,
  AppreciationsUnavailableError,
  createAppreciation,
  listAllAppreciations,
  listAppreciationsByNominator
} from '@/lib/appreciationStore';

// Employee Appreciation — list + submit.
//   GET  HR Manager / admin: every appreciation; managers: the ones they submitted.
//   POST managers / department heads / admin: nominate an employee in scope.

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

function parseSavings(raw: unknown): AppreciationSavings {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const timeSavingsUnit = str(body.timeSavingsUnit, 10);
  return {
    costSavingsPerMonth: str(body.costSavingsPerMonth, 60),
    timeSavingsValue: str(body.timeSavingsValue, 60),
    timeSavingsUnit: (TIME_SAVINGS_UNITS as readonly string[]).includes(timeSavingsUnit) ? (timeSavingsUnit as AppreciationSavings['timeSavingsUnit']) : '',
    energySavings: str(body.energySavings, 200),
    teamCostSavings: str(body.teamCostSavings, 60),
    miscellaneous: str(body.miscellaneous, 500)
  };
}

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
    return NextResponse.json({ rows, isDecider, canSubmit });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const employeeId = str(body?.employeeId, 64);
  const taskGivenDate = str(body?.taskGivenDate, 10);
  const taskDeadlineDate = str(body?.taskDeadlineDate, 10);
  const taskCompletionDate = str(body?.taskCompletionDate, 10);
  const savings = parseSavings(body?.savings ?? EMPTY_SAVINGS);
  const description = str(body?.description);
  const attachmentUrl = str(body?.attachmentUrl, 2000);

  if (!employeeId) return NextResponse.json({ error: 'Pick the employee you are appreciating' }, { status: 400 });
  if (!DATE_RE.test(taskGivenDate) || Number.isNaN(Date.parse(taskGivenDate))) {
    return NextResponse.json({ error: 'Task given date is required' }, { status: 400 });
  }
  if (!DATE_RE.test(taskDeadlineDate) || Number.isNaN(Date.parse(taskDeadlineDate))) {
    return NextResponse.json({ error: 'Task deadline date is required' }, { status: 400 });
  }
  if (!DATE_RE.test(taskCompletionDate) || Number.isNaN(Date.parse(taskCompletionDate))) {
    return NextResponse.json({ error: 'Task completion date is required' }, { status: 400 });
  }
  if (taskDeadlineDate < taskGivenDate) return NextResponse.json({ error: 'Task deadline date cannot be before the task given date' }, { status: 400 });
  if (taskCompletionDate < taskGivenDate) return NextResponse.json({ error: 'Task completion date cannot be before the task given date' }, { status: 400 });
  if (taskCompletionDate > todayIso()) return NextResponse.json({ error: 'Task completion date cannot be in the future' }, { status: 400 });
  if (description.length < 10) return NextResponse.json({ error: 'Describe what they did (at least 10 characters)' }, { status: 400 });

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
