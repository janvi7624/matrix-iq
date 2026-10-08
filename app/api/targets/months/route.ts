import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageTargets } from '@/lib/targetAccess';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { currentFiscalYear } from '@/lib/targetPeriod';
import { fiscalYearMonthKeys, rollupSummary } from '@/lib/targetRollup';
import { findMonthAmounts } from '@/lib/salesTargetStore';
import { apiErrorResponse } from '@/lib/apiError';

// The 12 monthly figures on file for one employee's fiscal year, which is
// what the target form prefills its month grid from. A separate endpoint from
// GET /api/targets because that one answers "the whole roster at one period"
// — this answers "one person across the whole year", the shape the form needs
// to let each month differ.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const employeeId = url.searchParams.get('employeeId') || '';
  const fiscalYear = url.searchParams.get('fiscalYear') || currentFiscalYear();
  if (!employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });

  try {
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(employeeId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const stored = await findMonthAmounts(employeeId, fiscalYear);
    // Every month of the FY is present in the response, zero-filled, so the
    // form renders a complete grid without having to know the FY calendar.
    const months: Record<string, number> = {};
    for (const key of fiscalYearMonthKeys(fiscalYear)) months[key] = stored[key] ?? 0;

    return NextResponse.json({ employeeId, fiscalYear, months, rollup: rollupSummary(fiscalYear, months) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
