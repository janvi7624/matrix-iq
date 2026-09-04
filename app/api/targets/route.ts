import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageTargets, listSalesTeamRoster } from '@/lib/targetAccess';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { buildPeriod, currentFiscalYear, periodContainingDate, TargetPeriodType } from '@/lib/targetPeriod';
import { createSalesTarget, DuplicateTargetError, findSalesTarget, listSalesTargets } from '@/lib/salesTargetStore';
import { computeAchievementForEmployees, computeStatus } from '@/lib/salesAchievement';
import { apiErrorResponse } from '@/lib/apiError';

const VALID_PERIOD_TYPES: TargetPeriodType[] = ['monthly', 'quarterly', 'half_yearly', 'annual'];

function resolvePeriod(url: URL) {
  const periodTypeParam = url.searchParams.get('periodType');
  const periodType: TargetPeriodType = VALID_PERIOD_TYPES.includes(periodTypeParam as TargetPeriodType) ? (periodTypeParam as TargetPeriodType) : 'monthly';
  const fiscalYear = url.searchParams.get('fiscalYear') || currentFiscalYear();
  const periodKey = url.searchParams.get('periodKey') ?? undefined;
  if (periodKey !== undefined) return buildPeriod(periodType, fiscalYear, periodKey || undefined);
  return periodContainingDate(periodType);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const period = resolvePeriod(new URL(request.url));
    const roster = await listSalesTeamRoster(viewer.username);
    const employeeIds = roster.map((r) => r.id);

    const [targets, achievements] = await Promise.all([
      listSalesTargets({ periodType: period.periodType, periodStart: period.periodStart, employeeIds }),
      computeAchievementForEmployees(employeeIds, period.periodStart, period.periodEnd)
    ]);
    const targetByEmployeeId = new Map(targets.map((t) => [t.employeeId, t]));

    let totalTarget = 0;
    let totalAchieved = 0;
    let exceededCount = 0;
    let achievedCount = 0;
    let onTrackCount = 0;
    let atRiskCount = 0;
    let notStartedCount = 0;

    const employees = roster.map((member) => {
      const target = targetByEmployeeId.get(member.id);
      const achievedAmount = achievements[member.id]?.achievedAmount ?? 0;
      const targetAmount = target?.targetAmount ?? 0;
      const status = computeStatus(targetAmount, achievedAmount, period.periodStart, period.periodEnd);
      const achievementPercent = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0;

      totalTarget += targetAmount;
      totalAchieved += achievedAmount;
      if (status === 'exceeded') exceededCount++;
      else if (status === 'achieved') achievedCount++;
      else if (status === 'on_track') onTrackCount++;
      else if (status === 'at_risk') atRiskCount++;
      else notStartedCount++;

      return {
        employeeId: member.id,
        username: member.username,
        name: member.name,
        designation: member.designation,
        targetId: target?.id ?? null,
        targetAmount,
        achievedAmount,
        achievementPercent,
        status,
        updatedAt: target?.updatedAt ?? ''
      };
    });

    return NextResponse.json({
      periodType: period.periodType,
      fiscalYear: period.fiscalYear,
      periodKey: period.periodKey,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      displayPeriod: period.displayPeriod,
      summary: {
        totalTarget,
        totalAchieved,
        achievementPercent: totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0,
        employeeCount: roster.length,
        exceededCount,
        achievedCount,
        onTrackCount,
        atRiskCount,
        notStartedCount
      },
      employees
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
  const periodType: TargetPeriodType | null = VALID_PERIOD_TYPES.includes(body.periodType) ? (body.periodType as TargetPeriodType) : null;
  const fiscalYear = typeof body.fiscalYear === 'string' ? body.fiscalYear : '';
  const periodKey = body.month || body.quarter || body.half || undefined;
  const targetAmount = Number(body.targetAmount);
  const notes = typeof body.notes === 'string' ? body.notes : '';

  if (!employeeId) return NextResponse.json({ error: 'Employee is required' }, { status: 400 });
  if (!periodType) return NextResponse.json({ error: 'A valid period type is required' }, { status: 400 });
  if (!fiscalYear) return NextResponse.json({ error: 'Fiscal year is required' }, { status: 400 });
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return NextResponse.json({ error: 'Target amount must be greater than zero' }, { status: 400 });

  try {
    // An employee outside the viewer's own visibility scope can't be given a
    // target — the same rule the roster listing itself already enforces.
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(employeeId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const period = buildPeriod(periodType, fiscalYear, periodKey);
    const existing = await findSalesTarget(employeeId, periodType, period.periodStart);
    if (existing) return NextResponse.json({ error: 'A target already exists for this employee and period' }, { status: 409 });

    const created = await createSalesTarget({
      employeeId,
      periodType,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      displayPeriod: period.displayPeriod,
      fiscalYear,
      targetAmount,
      notes,
      createdBy: viewer.userId
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateTargetError) return NextResponse.json({ error: error.message }, { status: 409 });
    return apiErrorResponse(error);
  }
}
