import { periodContainingDate } from './targetPeriod';
import { findSalesTarget } from './salesTargetStore';
import { AchievementResult, computeAchievement, computeAchievementForEmployees } from './salesAchievement';
import { buildTargetProgress, TargetProgress } from './targetProgress';
import { listOwnManagedSalesTeam } from './targetAccess';

// The viewer's own target + achievement, for the Dashboard's "My Target"
// panel — extracted from app/api/targets/me/route.ts (still the standalone
// endpoint, now a thin wrapper around this) so app/api/dashboard/route.ts
// can fold it into the Dashboard's one combined payload too.
//
// Deliberately 3 of TargetPeriodType's 4 values, not all of them — the panel
// never offered a half_yearly tab, matching the original route exactly.
type DashboardTargetScale = 'monthly' | 'quarterly' | 'annual';
const SCALES: DashboardTargetScale[] = ['monthly', 'quarterly', 'annual'];

export interface MyTargetPeriodProgress extends TargetProgress {
  periodType: DashboardTargetScale;
  displayPeriod: string;
  periodStart: string;
  periodEnd: string;
  fiscalYear: number;
  hasTarget: boolean;
  notes: string;
  dealCount: number;
  ownAchievedAmount: number;
  teamAchievedAmount: number;
  teamMemberCount: number;
}

export interface MyTargetSummary {
  hasAnyTarget: boolean;
  teamMembers: string[];
  periods: Record<DashboardTargetScale, MyTargetPeriodProgress>;
}

export async function buildMyTargetSummary(viewerUserId: string, viewerUsername: string): Promise<MyTargetSummary> {
  const now = new Date();
  // A Sales/GEM-Sales department manager's own figure here rolls up their
  // directly-managed team too (explicit ask: a teammate closing a deal
  // "should also count in [the manager] too") — resolved once since who
  // manages whom doesn't vary by period scale.
  const team = await listOwnManagedSalesTeam(viewerUsername, viewerUserId);
  const teamMemberIds = team.map((m) => m.id);

  const entries = await Promise.all(
    SCALES.map(async (periodType) => {
      const period = periodContainingDate(periodType, now);
      const [target, achievement, teamAchievements] = await Promise.all([
        findSalesTarget(viewerUserId, periodType, period.periodStart),
        computeAchievement(viewerUserId, period.periodStart, period.periodEnd),
        teamMemberIds.length
          ? computeAchievementForEmployees(teamMemberIds, period.periodStart, period.periodEnd)
          : Promise.resolve<Record<string, AchievementResult>>({})
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
          ownAchievedAmount: achievement.achievedAmount,
          teamAchievedAmount,
          teamMemberCount: teamMemberIds.length,
          ...buildTargetProgress(target?.targetAmount ?? 0, combinedAchievedAmount, period.periodStart, period.periodEnd, now)
        }
      ] as const;
    })
  );

  const periods = Object.fromEntries(entries) as unknown as Record<DashboardTargetScale, MyTargetPeriodProgress>;

  return {
    hasAnyTarget: entries.some(([, p]) => p.hasTarget),
    teamMembers: team.map((m) => m.name),
    periods
  };
}
