import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageTargets } from '@/lib/targetAccess';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { buildPeriod, currentFiscalYear, periodContainingDate, TargetPeriodType } from '@/lib/targetPeriod';
import { findSalesTarget } from '@/lib/salesTargetStore';
import { computeStatus, listQualifyingQuotations } from '@/lib/salesAchievement';
import { findUserById } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

const VALID_PERIOD_TYPES: TargetPeriodType[] = ['monthly', 'quarterly', 'half_yearly', 'annual'];

export async function GET(request: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { employeeId } = await params;

  try {
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(employeeId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const employee = await findUserById(employeeId);
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const url = new URL(request.url);
    const periodTypeParam = url.searchParams.get('periodType');
    const periodType: TargetPeriodType = VALID_PERIOD_TYPES.includes(periodTypeParam as TargetPeriodType) ? (periodTypeParam as TargetPeriodType) : 'monthly';
    const fiscalYear = url.searchParams.get('fiscalYear') || currentFiscalYear();
    const periodKey = url.searchParams.get('periodKey');
    const period = periodKey !== null ? buildPeriod(periodType, fiscalYear, periodKey || undefined) : periodContainingDate(periodType);

    const target = await findSalesTarget(employeeId, periodType, period.periodStart);
    const qualifyingQuotations = await listQualifyingQuotations(employeeId, period.periodStart, period.periodEnd);
    const achievedAmount = qualifyingQuotations.reduce((sum, q) => sum + q.total, 0);
    const targetAmount = target?.targetAmount ?? 0;
    const achievementPercent = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0;
    const status = computeStatus(targetAmount, achievedAmount, period.periodStart, period.periodEnd);

    return NextResponse.json({
      employee: { id: employee.id, username: employee.username, name: employee.name, department: employee.department, designation: employee.designation },
      target: target
        ? { id: target.id, periodType: target.periodType, displayPeriod: target.displayPeriod, targetAmount: target.targetAmount, notes: target.notes }
        : { id: null, periodType, displayPeriod: period.displayPeriod, targetAmount: 0, notes: '' },
      achievedAmount,
      achievementPercent,
      status,
      qualifyingQuotations
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
