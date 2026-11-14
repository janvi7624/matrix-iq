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
  APPRECIATION_CATEGORIES,
  REWARD_TYPES,
  RewardType,
  AppreciationsUnavailableError,
  createAppreciation,
  listAllAppreciations,
  listAppreciationsByNominator
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
    return NextResponse.json({ rows, isDecider, canSubmit, categories: APPRECIATION_CATEGORIES });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const employeeId = str(body?.employeeId, 64);
  const category = str(body?.category, 60);
  const achievementDate = str(body?.achievementDate, 10);
  const description = str(body?.description);
  const attachmentUrl = str(body?.attachmentUrl, 2000);
  const rewardType = (REWARD_TYPES as readonly string[]).includes(body?.rewardType) ? (body.rewardType as RewardType) : 'none';
  const rewardAmountRaw = body?.rewardAmount === '' || body?.rewardAmount == null ? null : Number(body.rewardAmount);

  if (!employeeId) return NextResponse.json({ error: 'Pick the employee you are appreciating' }, { status: 400 });
  if (!(APPRECIATION_CATEGORIES as readonly string[]).includes(category)) return NextResponse.json({ error: 'Pick a category' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(achievementDate) || Number.isNaN(Date.parse(achievementDate))) {
    return NextResponse.json({ error: 'Achievement date is required' }, { status: 400 });
  }
  if (achievementDate > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: 'Achievement date cannot be in the future' }, { status: 400 });
  if (description.length < 10) return NextResponse.json({ error: 'Describe what they did (at least 10 characters)' }, { status: 400 });
  let rewardAmount: number | null = null;
  if (rewardType === 'gift_voucher' || rewardType === 'cash') {
    if (rewardAmountRaw == null || !Number.isFinite(rewardAmountRaw) || rewardAmountRaw <= 0) {
      return NextResponse.json({ error: 'Enter the recommended reward amount' }, { status: 400 });
    }
    rewardAmount = Math.round(rewardAmountRaw * 100) / 100;
  }

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
      category,
      achievementDate,
      description,
      attachmentUrl,
      rewardType,
      rewardAmount
    });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'employee_appreciation', entityId: created.id,
      action: 'appreciation_submit', previousStatus: '', newStatus: 'pending',
      remarks: `${employee.name} — ${category}`, ip: getClientIp(request)
    });

    const hrManagers = findHrManagers(await listDepartmentManagers()).map((m) => m.username).filter((u) => u !== viewer.username);
    await notifyUsers(hrManagers, {
      title: 'Employee appreciation awaiting your review',
      body: `${created.nominated_by_name} appreciated ${employee.name} for ${category}.`,
      type: 'appreciation_submitted',
      entityType: 'employee_appreciation',
      entityId: created.id
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}
