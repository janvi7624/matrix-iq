import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { periodContainingDate, TargetPeriodType } from '@/lib/targetPeriod';
import { findSalesTarget } from '@/lib/salesTargetStore';
import { computeAchievement, computeAchievementForEmployees, AchievementResult } from '@/lib/salesAchievement';
import { buildTargetProgress } from '@/lib/targetProgress';
import { listOwnManagedSalesTeam } from '@/lib/targetAccess';
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
    // A Sales/GEM-Sales department manager's own figure here rolls up their
    // directly-managed team too (explicit ask: a teammate closing a deal
    // "should also count in [the manager] too") — resolved once since who
    // manages whom doesn't vary by period scale.
    const team = await listOwnManagedSalesTeam(viewer.username, viewer.userId);
    const teamMemberIds = team.map((m) => m.id);

    const entries = await Promise.all(
      SCALES.map(async (periodType) => {
        const period = periodContainingDate(periodType, now);
        const [target, achievement, teamAchievements] = await Promise.all([
          findSalesTarget(viewer.userId, periodType, period.periodStart),
          computeAchievement(viewer.userId, period.periodStart, period.periodEnd),
          teamMemberIds.length
            ? computeAchievementForEmployees(teamMemberIds, period.periodStart, period.periodEnd)
            : Promise.resolve({} as Record<string, AchievementResult>)
        ]);

        const teamAchievedAmount = Object.values(teamAchievements).reduce((sum, a) => sum + a.achievedAmount, 0);
        const teamDealCount = Object.values(teamAchievements).reduce((sum, a) => sum + a.qualifyingQuotationIds.length, 0);
        const combinedAchievedAmount = achievement.achievedAmount + teamAchievedAmount;

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
            dealCount: achievement.qualifyingQuotationIds.length + teamDealCount,
            // achievedAmount below (from buildTargetProgress) is the combined
            // figure that now drives the bar/%/status; these two are kept
            // alongside it so the UI can show WHERE the number came from
            // instead of a total that silently grew past what the rep closed
            // themself.
            ownAchievedAmount: achievement.achievedAmount,
            teamAchievedAmount,
            teamMemberCount: teamMemberIds.length,
            ...buildTargetProgress(target?.targetAmount ?? 0, combinedAchievedAmount, period.periodStart, period.periodEnd, now)
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
      teamMembers: team.map((m) => m.name),
      periods
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
