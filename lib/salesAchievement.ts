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
//
// "Attributed to employeeId" means whoever the quotation NAMES as its
// salesperson — prepared_by_user_id, falling back to the prepared_by name
// for a quotation old enough not to have captured the id — never the
// quotation's own created_by. Maulik or Khushi filing a quote "as Mahendra"
// (lib/quotationOnBehalf.ts) has to land the achievement on Mahendra, full
// stop, same simple rule lib/salesTeamSummary.ts applies for its Billing
// column.
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

// Who a qualifying quotation actually counts for — prepared_by_user_id when
// captured, else the prepared_by name resolved through `nameToId` (a legacy
// quotation old enough to predate that id column), else created_by as the
// last resort (predates prepared_by entirely). Never created_by on its own:
// that's whoever's session physically submitted the form, which is a
// technical/ops account whenever a quotation was filed on a sales person's
// behalf (lib/quotationOnBehalf.ts).
export function resolveQuotationOwner(plain: Record<string, unknown>, nameToId: Map<string, string>): string | undefined {
  const preparedByUserId = plain.prepared_by_user_id as string | null;
  if (preparedByUserId) return preparedByUserId;
  const preparedByName = (plain.prepared_by as string | null)?.trim();
  if (preparedByName) {
    const id = nameToId.get(preparedByName);
    if (id) return id;
  }
  return (plain.created_by as string | null) || undefined;
}

// name -> id for every active user, cached per call rather than per-module:
// this runs rarely enough (Target cards, employee table, drilldown — not a
// hot path) that a plain query beats the staleness risk of a longer-lived
// cache, and it's one cheap indexed query either way.
export async function fetchNameToId(): Promise<Map<string, string>> {
  // Active only: a suspended/exited former employee's name should never
  // silently absorb attribution (quotation ownership, daily-report
  // auto-fetch) meant for a current one. Soft-deleted rows are already
  // excluded by the model's paranoid default.
  const rows = await db.User.findAll({ where: { status: 'active' } as never, attributes: ['id', 'name'] });
  const map = new Map<string, string>();
  for (const row of rows) {
    const name = row.get('name') as string | null;
    if (name) map.set(name, row.get('id') as string);
  }
  return map;
}

// Qualifying = approved, linked to a won project — the project join exists
// only to enforce that (see the header comment), never to attribute; who
// the row counts for is resolved per-row by resolveQuotationOwner once
// fetched. Fetched for every qualifying quotation in the period (not
// filtered to employeeIds at the SQL level) because that attribution can't
// be expressed as a WHERE clause once it may hinge on a name lookup.
async function fetchQualifyingRows(periodStart: string, periodEnd: string) {
  return db.Quotation.findAll({
    where: {
      status: 'approved',
      project_id: { [Op.ne]: null },
      created_at: { [Op.gte]: periodStart, [Op.lt]: periodEndExclusive(periodEnd) }
    } as never,
    include: [
      {
        model: db.Project,
        as: 'project',
        required: true,
        // Used to also require stage === 'completed' (only ever set when
        // Installation was marked done) — that stage is retired from Project
        // Progress (management decision, 2026-09), so status === 'won' is now
        // the qualifying signal on its own.
        where: { status: 'won' } as never,
        attributes: []
      }
    ] as never
  });
}

export async function computeAchievement(employeeId: string, periodStart: string, periodEnd: string): Promise<AchievementResult> {
  const [rows, nameToId] = await Promise.all([fetchQualifyingRows(periodStart, periodEnd), fetchNameToId()]);
  let achievedAmount = 0;
  const qualifyingQuotationIds: string[] = [];
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    if (resolveQuotationOwner(plain, nameToId) !== employeeId) continue;
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

  const employeeIdSet = new Set(employeeIds);
  const [rows, nameToId] = await Promise.all([fetchQualifyingRows(periodStart, periodEnd), fetchNameToId()]);
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const employeeId = resolveQuotationOwner(plain, nameToId);
    if (!employeeId || !employeeIdSet.has(employeeId)) continue;
    result[employeeId].achievedAmount += toNumber(plain.total);
    result[employeeId].qualifyingQuotationIds.push(plain.id as string);
  }
  return result;
}

// Same attribution rule as fetchQualifyingRows/resolveQuotationOwner above —
// this drilldown has to list exactly the quotations computeAchievement
// summed for this employee, or the modal total and the card total disagree.
export async function listQualifyingQuotations(employeeId: string, periodStart: string, periodEnd: string): Promise<QualifyingQuotation[]> {
  const [rows, nameToId] = await Promise.all([fetchQualifyingRows(periodStart, periodEnd), fetchNameToId()]);
  return rows
    .map((row) => row.get({ plain: true }) as Record<string, unknown>)
    .filter((plain) => resolveQuotationOwner(plain, nameToId) === employeeId)
    .sort((a, b) => {
      const at = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));
      return at(b.createdAt).localeCompare(at(a.createdAt));
    })
    .map((plain) => ({
      id: plain.id as string,
      quotationNumber: (plain.quotation_number as string) ?? '',
      clientName: (plain.client_name as string) || (plain.client_company as string) || '',
      total: toNumber(plain.total),
      createdAt: plain.createdAt instanceof Date ? plain.createdAt.toISOString() : String(plain.createdAt ?? ''),
      projectId: (plain.project_id as string) ?? ''
    }));
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
