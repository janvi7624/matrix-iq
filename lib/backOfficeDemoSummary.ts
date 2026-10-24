import { db } from './db';
import { DeliveryChallanRecord } from './types';
import { readDeliveryChallans } from './deliveryChallanStore';
import { listActiveInternalEmployees } from './userStore';
import { monthKeyBounds } from './dateHelpers';
import { lastClaimableMonth } from './reimbursementPeriod';

// "Which sales person did how many demos (DCs) and what did those demos
// cost" — Back Office's own request. Follows the same precedent every other
// aggregate report in this app uses (app/api/backoffice/kpis/route.ts,
// lib/salesTeamSummary.ts): read the small, already-indexed table in full and
// aggregate in memory, rather than hand-rolling SQL GROUP BY for a dataset
// that's still in the low hundreds of rows.
//
// ATTRIBUTION — the one non-obvious design decision here. A DC has two
// candidate "whose demo is this" signals: `assigned_engineer` ("Requested
// By" — now a dropdown of real employees for every NEW or edited DC, see
// components/BackOfficeView.tsx's RequestedBySelect, but still free text on
// any DC created before that, and hand-editable text even now) and
// `project_id` (a real FK). project_id -> Project.created_by is tried FIRST
// — the same "who owns this project" convention lib/projectSalesOwner.ts
// establishes for every other sales dashboard in the app — because it's a
// real foreign key. Only when a DC has no project_id at all (ManualDcPanel's
// project picker is optional) does this fall back to resolving
// assigned_engineer against the real active-employee roster: an exact
// username match (every DC created since the dropdown shipped), else a
// case-insensitive name match (a historical free-text "Sachin Kacha"-style
// entry that happens to name a real employee) — this is the "automate and
// merge" a manual DC's free text into the right person's row, without ever
// rewriting the stored value. Anything left over (truly free text matching
// nobody, or genuinely blank) stays in "Unattributed / Manual" rather than
// being guessed at further.

export interface SalesPersonDemoSummaryRow {
  /** '' for the Unattributed/Manual bucket. */
  username: string;
  name: string;
  demoCount: number;
  /** Of demoCount, how many actually have a demo cost recorded (NOT demoCount itself — '' is not 0, see DeliveryChallanRecord.demo_cost_amount). */
  costRecordedCount: number;
  totalExpense: number;
}

export interface MonthlyTrendRow {
  monthKey: string; // 'YYYY-MM'
  label: string; // 'October 2026'
  demoCount: number;
  costRecordedCount: number;
  totalExpense: number;
}

export interface BackOfficeDemoSummaryReport {
  /** Empty when period === 'all'. */
  from: string;
  to: string;
  label: string;
  rows: SalesPersonDemoSummaryRow[];
  totals: { demoCount: number; costRecordedCount: number; totalExpense: number };
  /** Org-wide, oldest first — independent of the from/to filter above. */
  monthlyTrend: MonthlyTrendRow[];
}

export function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function monthLabelOf(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

// Walks backward from the month containing `now`, oldest first — the same
// "pass a negative month into the Date constructor and let it roll the year
// over for free" trick lib/reimbursementPeriod.ts's lastClaimableMonth uses.
export function trailingMonthKeys(count: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(monthKeyOf(d.getFullYear(), d.getMonth() + 1));
  }
  return keys;
}

// 'this_month' (default) | 'last_month' | 'all' | an explicit 'YYYY-MM'.
// Half-open [from, to) throughout, matching monthKeyBounds' own convention —
// deliberately not inclusive-end, so there's no day-before-the-1st
// arithmetic anywhere in this module.
export function resolvePeriodRange(period: string, now: Date = new Date()): { from: string; to: string; label: string } | null {
  if (period === 'all') return null;

  let key: string;
  if (period === 'last_month') {
    const { year, month } = lastClaimableMonth(now);
    key = monthKeyOf(year, month);
  } else if (/^\d{4}-\d{2}$/.test(period)) {
    key = period;
  } else {
    key = monthKeyOf(now.getFullYear(), now.getMonth() + 1); // 'this_month' and any unrecognized value
  }

  const bounds = monthKeyBounds(key);
  if (!bounds) return null;
  return { from: bounds.from, to: bounds.to, label: monthLabelOf(key) };
}

function addExpense(row: SalesPersonDemoSummaryRow, dc: DeliveryChallanRecord) {
  row.demoCount += 1;
  if (dc.demo_cost_amount !== '') {
    row.costRecordedCount += 1;
    row.totalExpense += Number(dc.demo_cost_amount) || 0;
  }
}

export interface EmployeeLookup {
  byUsername: Map<string, { username: string; name: string }>;
  /** Keyed by name, trimmed and lowercased. */
  byNameLower: Map<string, { username: string; name: string }>;
}

export function buildEmployeeLookup(employees: { username: string; name: string }[]): EmployeeLookup {
  const byUsername = new Map<string, { username: string; name: string }>();
  const byNameLower = new Map<string, { username: string; name: string }>();
  const nameCounts = new Map<string, number>();
  for (const e of employees) {
    byUsername.set(e.username, e);
    const nameLower = e.name.trim().toLowerCase();
    if (!nameLower) continue;
    byNameLower.set(nameLower, e);
    nameCounts.set(nameLower, (nameCounts.get(nameLower) ?? 0) + 1);
  }
  // A duplicate display name can't be told apart by name alone — dropping it
  // is safer than guessing which of two same-named employees a historical
  // free-text entry meant; it falls through to Unattributed instead.
  for (const [nameLower, count] of nameCounts) if (count > 1) byNameLower.delete(nameLower);
  return { byUsername, byNameLower };
}

// Resolves a free-text/username "Requested By" value against the real
// roster: exact username first (every DC made through the dropdown), then a
// case-insensitive name match (a historical manual DC whose typed text
// happens to name a real employee). Returns undefined for anything that
// matches nobody — never a guess.
export function resolveAssignedEngineer(assignedEngineer: string, lookup: EmployeeLookup): { username: string; name: string } | undefined {
  const value = assignedEngineer.trim();
  if (!value) return undefined;
  return lookup.byUsername.get(value) ?? lookup.byNameLower.get(value.toLowerCase());
}

// Pure — no DB access — so it's unit-testable without a database, same split
// as lib/hrExpenseReportStore.ts's aggregateHrExpenses. `employeeLookup` is
// optional so existing callers/tests that only care about project-based
// attribution don't need to thread a roster through — omitting it simply
// means no assigned_engineer fallback runs.
export function buildSalesPersonRows(
  dcs: DeliveryChallanRecord[],
  projectOwnerById: Map<string, { username: string; name: string }>,
  employeeLookup?: EmployeeLookup
): SalesPersonDemoSummaryRow[] {
  const byUsername = new Map<string, SalesPersonDemoSummaryRow>();
  const unattributed: SalesPersonDemoSummaryRow = { username: '', name: 'Unattributed / Manual', demoCount: 0, costRecordedCount: 0, totalExpense: 0 };

  for (const dc of dcs) {
    const owner =
      (dc.project_id ? projectOwnerById.get(dc.project_id) : undefined) ??
      (employeeLookup ? resolveAssignedEngineer(dc.assigned_engineer, employeeLookup) : undefined);
    if (!owner) {
      addExpense(unattributed, dc);
      continue;
    }
    let row = byUsername.get(owner.username);
    if (!row) {
      row = { username: owner.username, name: owner.name, demoCount: 0, costRecordedCount: 0, totalExpense: 0 };
      byUsername.set(owner.username, row);
    }
    addExpense(row, dc);
  }

  const rows = Array.from(byUsername.values()).sort(
    (a, b) => b.totalExpense - a.totalExpense || b.demoCount - a.demoCount || a.name.localeCompare(b.name)
  );
  // Always last regardless of its own total — it's a catch-all bucket, not a
  // ranked contributor, and burying a real top-spender below it would be
  // misleading.
  if (unattributed.demoCount > 0) rows.push(unattributed);
  return rows;
}

export function buildMonthlyTrend(dcs: DeliveryChallanRecord[], monthKeys: string[]): MonthlyTrendRow[] {
  const byMonth = new Map<string, { demoCount: number; costRecordedCount: number; totalExpense: number }>();
  for (const key of monthKeys) byMonth.set(key, { demoCount: 0, costRecordedCount: 0, totalExpense: 0 });

  for (const dc of dcs) {
    if (!dc.issued_date) continue;
    const bucket = byMonth.get(dc.issued_date.slice(0, 7));
    if (!bucket) continue; // outside the trend window
    bucket.demoCount += 1;
    if (dc.demo_cost_amount !== '') {
      bucket.costRecordedCount += 1;
      bucket.totalExpense += Number(dc.demo_cost_amount) || 0;
    }
  }

  return monthKeys.map((key) => ({ monthKey: key, label: monthLabelOf(key), ...byMonth.get(key)! }));
}

function sumTotals(rows: SalesPersonDemoSummaryRow[]): BackOfficeDemoSummaryReport['totals'] {
  return rows.reduce(
    (acc, r) => ({
      demoCount: acc.demoCount + r.demoCount,
      costRecordedCount: acc.costRecordedCount + r.costRecordedCount,
      totalExpense: acc.totalExpense + r.totalExpense
    }),
    { demoCount: 0, costRecordedCount: 0, totalExpense: 0 }
  );
}

// Batched: one query for every project a DC in the working set actually
// references, instead of N round-trips. Deliberately a direct, narrow
// Sequelize read (not projectStore.readAll(), which hydrates every one of
// Project's ~60 columns per row) — this only ever needs the resolved owner.
async function fetchProjectOwners(projectIds: string[]): Promise<Map<string, { username: string; name: string }>> {
  const map = new Map<string, { username: string; name: string }>();
  if (!projectIds.length) return map;
  const rows = await db.Project.findAll({
    where: { id: projectIds } as never,
    include: [{ model: db.User, as: 'creator', attributes: ['username', 'name'] }],
    attributes: ['id']
  });
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const creator = plain.creator as { username?: string; name?: string } | null;
    if (creator?.username) map.set(plain.id as string, { username: creator.username, name: creator.name || creator.username });
  }
  return map;
}

export interface BackOfficeDemoSummaryParams {
  /** 'this_month' (default) | 'last_month' | 'all' | 'YYYY-MM'. */
  period?: string;
  /** How many trailing months the monthlyTrend section covers. Default 6. */
  trendMonths?: number;
  now?: Date;
}

// The one DB-hitting entry point — both the dashboard route and the monthly
// email job call this, so the two can never disagree about what counts.
export async function getBackOfficeDemoSummary(params: BackOfficeDemoSummaryParams = {}): Promise<BackOfficeDemoSummaryReport> {
  const now = params.now ?? new Date();
  const trendMonths = params.trendMonths ?? 6;
  const trendKeys = trailingMonthKeys(trendMonths, now);
  const range = resolvePeriodRange(params.period ?? 'this_month', now);

  const [allDcs, activeEmployees] = await Promise.all([readDeliveryChallans(), listActiveInternalEmployees()]);
  const projectIds = Array.from(new Set(allDcs.map((dc) => dc.project_id).filter(Boolean)));
  const projectOwnerById = await fetchProjectOwners(projectIds);
  const employeeLookup = buildEmployeeLookup(activeEmployees);

  const inRange = range ? allDcs.filter((dc) => dc.issued_date && dc.issued_date >= range.from && dc.issued_date < range.to) : allDcs;

  const rows = buildSalesPersonRows(inRange, projectOwnerById, employeeLookup);
  return {
    from: range?.from ?? '',
    to: range?.to ?? '',
    label: range?.label ?? 'All Time',
    rows,
    totals: sumTotals(rows),
    monthlyTrend: buildMonthlyTrend(allDcs, trendKeys)
  };
}
