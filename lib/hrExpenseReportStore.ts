import { Op } from 'sequelize';
import { db } from './db';

// HR Expense Report — one aggregation over the three places company money
// is recorded, so HR can answer "what did we spend, by whom/which
// department, over which period" without opening three modules:
//
//   reimbursement     reimbursements  WHERE is_admin_entry = false
//                     (an employee claiming their own spend back)
//   admin_expense     reimbursements  WHERE is_admin_entry = true
//                     (company-paid hotel/ticket batches, already split into
//                      one row per employee — see app/api/admin-expenses)
//   office_operation  office_operation_expenses
//                     (office/electricity/pantry/... operating spend)
//
// Reimbursement and Admin Expense rows both live in the SAME table and are
// told apart only by is_admin_entry, so a single query covers both.
export type ExpenseSourceKey = 'reimbursement' | 'admin_expense' | 'office_operation';
export const EXPENSE_SOURCES: ExpenseSourceKey[] = ['reimbursement', 'admin_expense', 'office_operation'];
export const EXPENSE_SOURCE_LABEL: Record<ExpenseSourceKey, string> = {
  reimbursement: 'Reimbursement',
  admin_expense: 'Admin Expense',
  office_operation: 'Office Operation'
};

export type Granularity = 'month' | 'quarter' | 'year';
export type GroupBy = 'employee' | 'department' | 'source';

export interface HrExpenseReportParams {
  from: string;
  to: string;
  granularity: Granularity;
  groupBy: GroupBy;
  sources: ExpenseSourceKey[];
  department?: string;
  employeeId?: string;
  // Counts only money that has cleared its approval gate: an Admin Expense
  // batch signed off by the designated approver, and a Reimbursement whose
  // monthly sheet reached HR approval or payment. Office Operation entries
  // have no approval stage at all, so they are never excluded by this.
  approvedOnly: boolean;
}

export interface PeriodBucket {
  key: string;
  label: string;
}

export interface HrExpenseReportRow {
  key: string;
  label: string;
  sublabel: string;
  periods: Record<string, number>;
  sources: Record<ExpenseSourceKey, number>;
  entries: number;
  total: number;
}

export interface HrExpenseReport {
  from: string;
  to: string;
  granularity: Granularity;
  groupBy: GroupBy;
  sources: ExpenseSourceKey[];
  approvedOnly: boolean;
  buckets: PeriodBucket[];
  rows: HrExpenseReportRow[];
  periodTotals: Record<string, number>;
  sourceTotals: Record<ExpenseSourceKey, number>;
  grandTotal: number;
  entryCount: number;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APPROVED_SHEET_STATUSES = new Set(['hr_approved', 'payment_done']);

export function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function isGranularity(value: unknown): value is Granularity {
  return value === 'month' || value === 'quarter' || value === 'year';
}

export function isGroupBy(value: unknown): value is GroupBy {
  return value === 'employee' || value === 'department' || value === 'source';
}

export function isExpenseSource(value: unknown): value is ExpenseSourceKey {
  return EXPENSE_SOURCES.includes(value as ExpenseSourceKey);
}

// Date-only strings are split by hand rather than via `new Date()` — a
// DATEONLY column parsed as a Date is UTC midnight, which a negative-offset
// timezone renders as the previous day and would file a 1st-of-month expense
// under the wrong month.
function partsOf(date: string): { year: number; month: number } {
  const [year, month] = date.split('-').map(Number);
  return { year, month };
}

export function bucketKeyFor(date: string, granularity: Granularity): string {
  const { year, month } = partsOf(date);
  if (granularity === 'year') return String(year);
  if (granularity === 'quarter') return `${year}-Q${Math.ceil(month / 3)}`;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function bucketLabelFor(key: string, granularity: Granularity): string {
  if (granularity === 'year') return key;
  if (granularity === 'quarter') {
    const [year, q] = key.split('-');
    return `${q} ${year}`;
  }
  const [year, month] = key.split('-');
  return `${MONTH_ABBR[Number(month) - 1]} ${year}`;
}

// Every bucket between `from` and `to` inclusive, even the empty ones — a
// month with no spend has to appear in the matrix as a zero column rather
// than silently closing the gap, otherwise the columns misrepresent the
// period that was actually asked for.
export function bucketsBetween(from: string, to: string, granularity: Granularity): PeriodBucket[] {
  const start = partsOf(from);
  const end = partsOf(to);
  const keys: string[] = [];

  if (granularity === 'year') {
    for (let y = start.year; y <= end.year; y++) keys.push(String(y));
  } else if (granularity === 'quarter') {
    let y = start.year;
    let q = Math.ceil(start.month / 3);
    const endQ = Math.ceil(end.month / 3);
    while (y < end.year || (y === end.year && q <= endQ)) {
      keys.push(`${y}-Q${q}`);
      q += 1;
      if (q > 4) { q = 1; y += 1; }
    }
  } else {
    let y = start.year;
    let m = start.month;
    while (y < end.year || (y === end.year && m <= end.month)) {
      keys.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }

  return keys.map((key) => ({ key, label: bucketLabelFor(key, granularity) }));
}

function zeroSources(): Record<ExpenseSourceKey, number> {
  return { reimbursement: 0, admin_expense: 0, office_operation: 0 };
}

// One expense, normalized across the three registers. Public so the
// aggregation below can be exercised without a database.
export interface ExpenseEntry {
  source: ExpenseSourceKey;
  date: string;
  amount: number;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
}

// departmentRef.name is the real department (departmentId is the FK); the
// `department` string column is the legacy free-text copy kept for API
// compatibility. Resolved in that order here to match
// lib/userStore.ts's toPublicUser exactly — reading only the string column
// would file anyone whose department was set after the FK migration under
// "No department".
const CREATOR_INCLUDE = [
  {
    model: db.User,
    as: 'creator',
    attributes: ['id', 'username', 'name', 'employeeId', 'department'],
    include: [{ model: db.Department, as: 'departmentRef', attributes: ['name'] }]
  }
];

function creatorOf(plain: Record<string, unknown>): { employeeId: string; employeeName: string; employeeCode: string; department: string } {
  const creator = plain.creator as Record<string, unknown> | undefined;
  const deptRef = creator?.departmentRef as { name?: string } | null | undefined;
  return {
    employeeId: (plain.created_by as string) || '',
    employeeName: (creator?.name as string) || (creator?.username as string) || 'Unknown',
    employeeCode: (creator?.employeeId as string) || '',
    department: deptRef?.name || (creator?.department as string) || ''
  };
}

// Read-time aggregation, org-wide and deliberately unscoped: the whole
// module is HR + Admin + Super Admin only (hr-reports is in
// moduleConfigStore's HR_RESTRICTED_KEYS), and a spend report that silently
// showed one viewer a different total than another would be worse than no
// report at all.
export async function getHrExpenseReport(params: HrExpenseReportParams): Promise<HrExpenseReport> {
  const { from, to, sources, approvedOnly } = params;
  const wantReimbursement = sources.includes('reimbursement');
  const wantAdmin = sources.includes('admin_expense');
  const wantOffice = sources.includes('office_operation');
  const dateWhere = { date: { [Op.gte]: from, [Op.lte]: to } };

  const entries: ExpenseEntry[] = [];

  if (wantReimbursement || wantAdmin) {
    const isAdminEntry = wantReimbursement && wantAdmin ? undefined : wantAdmin;
    const rows = await db.Reimbursement.findAll({
      where: { ...dateWhere, ...(isAdminEntry === undefined ? {} : { is_admin_entry: isAdminEntry }) } as never,
      include: CREATOR_INCLUDE as never,
      order: [['date', 'ASC']]
    });

    // A normal reimbursement has no approval column of its own — its state
    // lives on the ReimbursementSheet for (employee, year, month), which is
    // derived rather than joined (there is no sheet_id on the entry). One
    // extra query builds that lookup instead of one per row.
    let approvedSheets: Set<string> | null = null;
    if (approvedOnly && wantReimbursement) {
      const sheets = await db.ReimbursementSheet.findAll({ attributes: ['created_by', 'year', 'month', 'status'] });
      approvedSheets = new Set(
        sheets
          .map((s) => s.get({ plain: true }) as Record<string, unknown>)
          .filter((s) => APPROVED_SHEET_STATUSES.has(s.status as string))
          .map((s) => `${s.created_by}|${s.year}|${s.month}`)
      );
    }

    for (const row of rows) {
      const plain = row.get({ plain: true }) as Record<string, unknown>;
      const isAdmin = !!plain.is_admin_entry;
      const source: ExpenseSourceKey = isAdmin ? 'admin_expense' : 'reimbursement';
      if (isAdmin && !wantAdmin) continue;
      if (!isAdmin && !wantReimbursement) continue;

      const date = plain.date as string;
      const creator = creatorOf(plain);

      if (approvedOnly) {
        if (isAdmin) {
          if (plain.approval_status !== 'approved') continue;
        } else if (approvedSheets) {
          const { year, month } = partsOf(date);
          if (!approvedSheets.has(`${creator.employeeId}|${year}|${month}`)) continue;
        }
      }

      entries.push({ source, date, amount: Number(plain.amount) || 0, ...creator });
    }
  }

  if (wantOffice) {
    const rows = await db.OfficeOperationExpense.findAll({
      where: dateWhere as never,
      include: CREATOR_INCLUDE as never,
      order: [['date', 'ASC']]
    });
    for (const row of rows) {
      const plain = row.get({ plain: true }) as Record<string, unknown>;
      entries.push({
        source: 'office_operation',
        date: plain.date as string,
        amount: Number(plain.amount) || 0,
        ...creatorOf(plain)
      });
    }
  }

  return aggregateHrExpenses(entries, params);
}

// The whole report, computed from already-fetched entries — no database
// access, so the bucketing/grouping/rounding rules can be tested directly.
export function aggregateHrExpenses(entries: ExpenseEntry[], params: HrExpenseReportParams): HrExpenseReport {
  const { from, to, granularity, groupBy, sources, department, employeeId, approvedOnly } = params;

  const filtered = entries.filter(
    (e) => (!department || e.department === department) && (!employeeId || e.employeeId === employeeId)
  );

  const buckets = bucketsBetween(from, to, granularity);
  const bucketKeys = new Set(buckets.map((b) => b.key));

  const periodTotals: Record<string, number> = {};
  buckets.forEach((b) => { periodTotals[b.key] = 0; });
  const sourceTotals = zeroSources();

  // One row per employee / department / expense type, depending on what was
  // asked for. The row identity is the ONLY thing that changes between the
  // three groupings — every figure below it is accumulated identically.
  const rowMap = new Map<string, HrExpenseReportRow & { employeeIds: Set<string> }>();

  for (const e of filtered) {
    const bucketKey = bucketKeyFor(e.date, granularity);
    // Defensive: an entry outside the requested buckets can only happen if
    // the range and the data disagree, and must not create a phantom column.
    if (!bucketKeys.has(bucketKey)) continue;

    const identity =
      groupBy === 'employee'
        ? { key: e.employeeId, label: e.employeeName, sublabel: [e.employeeCode, e.department].filter(Boolean).join(' · ') }
        : groupBy === 'department'
          ? { key: e.department || '—', label: e.department || 'No department', sublabel: '' }
          : { key: e.source, label: EXPENSE_SOURCE_LABEL[e.source], sublabel: '' };

    let row = rowMap.get(identity.key);
    if (!row) {
      row = {
        ...identity,
        periods: Object.fromEntries(buckets.map((b) => [b.key, 0])),
        sources: zeroSources(),
        entries: 0,
        total: 0,
        employeeIds: new Set<string>()
      };
      rowMap.set(identity.key, row);
    }

    row.periods[bucketKey] += e.amount;
    row.sources[e.source] += e.amount;
    row.entries += 1;
    row.total += e.amount;
    row.employeeIds.add(e.employeeId);

    periodTotals[bucketKey] += e.amount;
    sourceTotals[e.source] += e.amount;
  }

  const rows: HrExpenseReportRow[] = [...rowMap.values()]
    .map(({ employeeIds, ...row }) => ({
      ...row,
      sublabel:
        groupBy === 'department'
          ? `${employeeIds.size} ${employeeIds.size === 1 ? 'employee' : 'employees'}`
          : row.sublabel,
      total: round2(row.total),
      periods: roundAll(row.periods),
      sources: roundAll(row.sources) as Record<ExpenseSourceKey, number>
    }))
    .sort((a, b) => b.total - a.total);

  // A row that only carried entries outside the requested buckets would be
  // all zeroes; only possible via the defensive skip above, and it has no
  // business in the table.
  const visibleRows = rows.filter((row) => row.entries > 0);

  return {
    from,
    to,
    granularity,
    groupBy,
    sources,
    approvedOnly,
    buckets,
    rows: visibleRows,
    periodTotals: roundAll(periodTotals),
    sourceTotals: roundAll(sourceTotals) as Record<ExpenseSourceKey, number>,
    grandTotal: round2(visibleRows.reduce((sum, row) => sum + row.total, 0)),
    entryCount: visibleRows.reduce((sum, row) => sum + row.entries, 0)
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundAll<T extends Record<string, number>>(obj: T): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round2(v)]));
}
