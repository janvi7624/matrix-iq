import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { periodContainingDate, TargetPeriodType } from '@/lib/targetPeriod';
import { findSalesTarget } from '@/lib/salesTargetStore';
import { computeAchievement } from '@/lib/salesAchievement';
import { buildTargetProgress } from '@/lib/targetProgress';
import { apiErrorResponse } from '@/lib/apiError';

// The viewer's OWN target and achievement, for the Dashboard panel. No
// canManageTargets gate: that permission is about setting other people's
// targets, and a rep being unable to see their own number would be absurd.
// The employee id is taken from the session, never from the query string, so
// this endpoint cannot be pointed at a colleague.
//
// All three scales are returned in one response rather than one per request:
// the panel's Monthly/Quarterly/Yearly toggle is then instant, and the three
// figures on screen are guaranteed to come from the same moment (a per-tab
// refetch could straddle a new approved quotation and show a quarter that
// disagrees with the month inside it).
const SCALES: TargetPeriodType[] = ['monthly', 'quarterly', 'annual'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const now = new Date();
    const entries = await Promise.all(
      SCALES.map(async (periodType) => {
        const period = periodContainingDate(periodType, now);
        const [target, achievement] = await Promise.all([
          findSalesTarget(viewer.userId, periodType, period.periodStart),
          computeAchievement(viewer.userId, period.periodStart, period.periodEnd)
        ]);

        return [
          periodType,
          {
            periodType,
            displayPeriod: target?.displayPeriod || period.displayPeriod,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            fiscalYear: period.fiscalYear,
            hasTarget: !!target,
            notes: target?.notes ?? '',
            dealCount: achievement.qualifyingQuotationIds.length,
            ...buildTargetProgress(target?.targetAmount ?? 0, achievement.achievedAmount, period.periodStart, period.periodEnd, now)
          }
        ] as const;
      })
    );

    const periods = Object.fromEntries(entries);

    return NextResponse.json({
      // Lets the Dashboard hide the panel entirely for everyone who isn't
      // carrying a number — HR, Accounts, Technical — rather than showing
      // them an empty "₹0 of ₹0".
      hasAnyTarget: entries.some(([, p]) => p.hasTarget),
      periods
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
