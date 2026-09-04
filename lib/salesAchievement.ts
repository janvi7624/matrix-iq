import { Op } from 'sequelize';
import { db } from './db';
import { periodEndExclusive, periodContainingDate, TargetPeriodType } from './targetPeriod';
import { findSalesTarget } from './salesTargetStore';

// The single authoritative "Won + Closed + Billing" calculation. Every
// consumer (summary cards, employee table, drilldown modal, Performance
// Graph hook) calls through here — there is exactly one place achievement
// could ever be computed inconsistently or double-counted, and it's this one,
// always re-derived live from Quotation/Project rows, never stored.
//
// Qualifying = Quotation.status='approved' AND it has a project_id AND that
// Project has status='won' AND stage='completed'. A quotation with no
// project_id never qualifies, even if approved (confirmed business rule —
// there's no other way to verify a standalone quotation was actually
// "closed", only "the client accepted the price"). Attributed to the period
// containing the quotation's created_at (the only timestamp on a qualifying
// quotation that means "when this happened").
export type TargetStatus = 'not_started' | 'on_track' | 'at_risk' | 'achieved' | 'exceeded';

export interface AchievementResult {
  employeeId: string;
  achievedAmount: number;
  qualifyingQuotationIds: string[];
}

export interface QualifyingQuotation {
  id: string;
  quotationNumber: string;
  clientName: string;
  total: number;
  createdAt: string;
  projectId: string;
}

export interface TargetSnapshot {
  periodType: TargetPeriodType;
  displayPeriod: string;
  targetAmount: number;
  achievedAmount: number;
  achievementPercent: number;
  status: TargetStatus;
}

function toNumber(v: unknown): number {
  return Number(v) || 0;
}

async function fetchQualifyingRows(employeeIds: string[], periodStart: string, periodEnd: string) {
  if (!employeeIds.length) return [];
  return db.Quotation.findAll({
    where: {
      created_by: { [Op.in]: employeeIds },
      status: 'approved',
      project_id: { [Op.ne]: null },
      created_at: { [Op.gte]: periodStart, [Op.lt]: periodEndExclusive(periodEnd) }
    } as never,
    include: [
      {
        model: db.Project,
        as: 'project',
        required: true,
        where: { status: 'won', stage: 'completed' } as never,
        attributes: []
      }
    ] as never
  });
}

export async function computeAchievement(employeeId: string, periodStart: string, periodEnd: string): Promise<AchievementResult> {
  const rows = await fetchQualifyingRows([employeeId], periodStart, periodEnd);
  let achievedAmount = 0;
  const qualifyingQuotationIds: string[] = [];
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    achievedAmount += toNumber(plain.total);
    qualifyingQuotationIds.push(plain.id as string);
  }
  return { employeeId, achievedAmount, qualifyingQuotationIds };
}

// One batched query for every employee in a period (the employee-wise table),
// rather than N round-trips.
export async function computeAchievementForEmployees(
  employeeIds: string[],
  periodStart: string,
  periodEnd: string
): Promise<Record<string, AchievementResult>> {
  const result: Record<string, AchievementResult> = {};
  for (const id of employeeIds) result[id] = { employeeId: id, achievedAmount: 0, qualifyingQuotationIds: [] };
  if (!employeeIds.length) return result;

  const rows = await fetchQualifyingRows(employeeIds, periodStart, periodEnd);
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const employeeId = plain.created_by as string;
    if (!result[employeeId]) result[employeeId] = { employeeId, achievedAmount: 0, qualifyingQuotationIds: [] };
    result[employeeId].achievedAmount += toNumber(plain.total);
    result[employeeId].qualifyingQuotationIds.push(plain.id as string);
  }
  return result;
}

export async function listQualifyingQuotations(employeeId: string, periodStart: string, periodEnd: string): Promise<QualifyingQuotation[]> {
  const rows = await db.Quotation.findAll({
    where: {
      created_by: employeeId,
      status: 'approved',
      project_id: { [Op.ne]: null },
      created_at: { [Op.gte]: periodStart, [Op.lt]: periodEndExclusive(periodEnd) }
    } as never,
    include: [{ model: db.Project, as: 'project', required: true, where: { status: 'won', stage: 'completed' } as never, attributes: [] }] as never,
    order: [['created_at', 'DESC']]
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      id: plain.id as string,
      quotationNumber: (plain.quotation_number as string) ?? '',
      clientName: (plain.client_name as string) || (plain.client_company as string) || '',
      total: toNumber(plain.total),
      createdAt: plain.createdAt instanceof Date ? plain.createdAt.toISOString() : String(plain.createdAt ?? ''),
      projectId: (plain.project_id as string) ?? ''
    };
  });
}

// Simple, explainable thresholds — no existing status-band convention to
// match, so this is deliberately the simplest rule that satisfies "exceeded
// beats achieved beats on-track beats at-risk":
//   no target row                          -> not_started
//   ratio >= 110%                          -> exceeded
//   ratio >= 100%                          -> achieved
//   period ended, ratio < 100%             -> at_risk
//   period ongoing, pacing >= elapsed time -> on_track
//   otherwise                              -> at_risk
export function computeStatus(targetAmount: number, achievedAmount: number, periodStart: string, periodEnd: string, now: Date = new Date()): TargetStatus {
  if (!targetAmount) return 'not_started';
  const ratio = achievedAmount / targetAmount;
  if (ratio >= 1.1) return 'exceeded';
  if (ratio >= 1) return 'achieved';

  const start = new Date(`${periodStart}T00:00:00`).getTime();
  const end = new Date(`${periodEnd}T23:59:59`).getTime();
  const nowMs = now.getTime();

  if (nowMs > end) return 'at_risk';

  const elapsedRatio = Math.min(1, Math.max(0, (nowMs - start) / (end - start)));
  if (ratio >= elapsedRatio) return 'on_track';
  return 'at_risk';
}

// Performance Graph hook — "how is this employee doing against their current
// period's target," gated by the caller checking canManageTargets first.
// Defaults to the monthly period, the finest-grained one, since that's the
// most useful at-a-glance figure on a person's dashboard.
export async function currentPeriodSnapshot(employeeId: string, periodType: TargetPeriodType = 'monthly'): Promise<TargetSnapshot | null> {
  const period = periodContainingDate(periodType);
  const target = await findSalesTarget(employeeId, periodType, period.periodStart);
  if (!target) return null;

  const { achievedAmount } = await computeAchievement(employeeId, period.periodStart, period.periodEnd);
  const achievementPercent = target.targetAmount > 0 ? Math.round((achievedAmount / target.targetAmount) * 100) : 0;
  const status = computeStatus(target.targetAmount, achievedAmount, period.periodStart, period.periodEnd);

  return { periodType, displayPeriod: target.displayPeriod, targetAmount: target.targetAmount, achievedAmount, achievementPercent, status };
}
