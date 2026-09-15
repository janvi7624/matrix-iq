import { Op } from 'sequelize';
import { db } from './db';

export interface AdminExpenseReportRow {
  batchId: string;
  date: string;
  monthLabel: string;
  employeeId: string;
  employeeName: string;
  description: string;
  fromLocation: string;
  toLocation: string;
  amount: number;
}

export interface AdminExpenseEmployeeSummary {
  employeeId: string;
  employeeName: string;
  expenseCount: number;
  totalAmount: number;
}

export interface AdminExpenseReport {
  month: string; // 'YYYY-MM', echoed back
  monthLabel: string; // 'Sep-2026'
  rows: AdminExpenseReportRow[];
  totalExpenses: number;
  totalAmount: number;
  employeeSummary: AdminExpenseEmployeeSummary[];
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(month: unknown): month is string {
  return typeof month === 'string' && MONTH_KEY_RE.test(month);
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabelFor(month: string): string {
  const [year, mm] = month.split('-').map(Number);
  return `${MONTH_ABBR[mm - 1]}-${year}`;
}

function monthBoundaries(month: string): { start: string; end: string } {
  const [year, mm] = month.split('-').map(Number);
  const start = `${month}-01`;
  // Date.UTC's day-0 of month `mm` (0-indexed = the NEXT calendar month,
  // since `mm` here is already the 1-indexed target month number) lands on
  // the last day of the target month — avoids hardcoding days-per-month/leap
  // year logic.
  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

// Eligibility (documented per the spec's Part 7 requirement): is_admin_entry
// admin/company-paid batches, approval_status = 'approved' only — a pending
// batch isn't yet a confirmed company-paid expense (it may still be edited
// or declined before Hardik approves it, see lib/adminExpenseAccess.ts), so
// including it here would report on an unconfirmed number. payment_status
// ('payment_required' vs 'paid') is deliberately NOT part of this filter —
// whether Accounts has physically paid it yet is a separate concern from
// whether it's a real, approved, company-paid expense record.
//
// Month is determined by the `date` column — a Hotel row's check-in date,
// or the single travel/expense date for every other type (see
// db/models/reimbursement.js's own comment on `date` vs `check_out_date`).
// There is no other date field on this table that represents "when the
// expense was incurred."
export async function getAdminExpenseReport(month: string): Promise<AdminExpenseReport> {
  const { start, end } = monthBoundaries(month);

  const rows = await db.Reimbursement.findAll({
    where: {
      is_admin_entry: true,
      approval_status: 'approved',
      date: { [Op.gte]: start, [Op.lte]: end }
    } as never,
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }] as never,
    order: [['date', 'ASC']]
  });

  const monthLabel = monthLabelFor(month);
  const reportRows: AdminExpenseReportRow[] = rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const creator = plain.creator as Record<string, unknown> | undefined;
    return {
      batchId: (plain.admin_note as string) || (plain.id as string),
      date: plain.date as string,
      monthLabel,
      employeeId: plain.created_by as string,
      employeeName: (creator?.name as string) || (creator?.username as string) || (plain.created_by as string),
      description: (plain.description as string) || '',
      fromLocation: (plain.from_location as string) || '',
      toLocation: (plain.to_location as string) || '',
      amount: Number(plain.amount) || 0
    };
  });

  const totalAmount = reportRows.reduce((sum, r) => sum + r.amount, 0);

  const byEmployee = new Map<string, AdminExpenseEmployeeSummary>();
  for (const r of reportRows) {
    const existing = byEmployee.get(r.employeeId);
    if (existing) {
      existing.expenseCount += 1;
      existing.totalAmount += r.amount;
    } else {
      byEmployee.set(r.employeeId, { employeeId: r.employeeId, employeeName: r.employeeName, expenseCount: 1, totalAmount: r.amount });
    }
  }

  return {
    month,
    monthLabel,
    rows: reportRows,
    totalExpenses: reportRows.length,
    totalAmount,
    employeeSummary: [...byEmployee.values()].sort((a, b) => b.totalAmount - a.totalAmount)
  };
}
