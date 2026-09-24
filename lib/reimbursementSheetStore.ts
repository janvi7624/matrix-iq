import { Model, Op } from 'sequelize';
import { ReimbursementSheetRecord, ReimbursementSheetStatus } from './types';
import { db, isUuid, sequelize } from './db';
import { numberToIndianWords } from './numberToWords';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const INCLUDE_USERS = [
  { model: db.User, as: 'creator', attributes: ['id', 'username', 'name', 'employeeId', 'department', 'designation'] },
  { model: db.User, as: 'manager', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'hrReviewer', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'accountsHandler', attributes: ['id', 'username', 'name'] },
];

function userName(assoc: Record<string, unknown> | undefined | null): string | null {
  if (!assoc) return null;
  return (assoc.name as string) || (assoc.username as string) || null;
}

async function computeTotals(createdBy: string, year: number, month: number) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const rows = await db.Reimbursement.findAll({
    where: { created_by: createdBy, date: { [Op.gte]: startDate, [Op.lt]: endDate } } as never,
    attributes: ['amount', 'is_admin_entry'],
  });

  let total = 0;
  let count = 0;
  for (const r of rows) {
    const plain = r.get({ plain: true }) as Record<string, unknown>;
    if (plain.is_admin_entry) continue;
    total += Number(plain.amount) || 0;
    count++;
  }
  return { total: Math.round(total * 100) / 100, count, totalInWords: numberToIndianWords(total) };
}

function toRecord(row: Model, totals: { total: number; count: number; totalInWords: string }): ReimbursementSheetRecord {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const creator = p.creator as Record<string, unknown> | undefined;
  const manager = p.manager as Record<string, unknown> | undefined;
  const hr = p.hrReviewer as Record<string, unknown> | undefined;
  const accounts = p.accountsHandler as Record<string, unknown> | undefined;

  return {
    id: p.id as string,
    created_by: creator?.username as string ?? '',
    creator_name: (creator?.name as string) || (creator?.username as string) || '',
    creator_employee_id: (creator?.employeeId as string) || '',
    creator_department: (creator?.department as string) || '',
    creator_designation: (creator?.designation as string) || '',
    sheet_code: (p.sheet_code as string) || '',
    month: p.month as number,
    year: p.year as number,
    status: p.status as ReimbursementSheetStatus,
    manager_id: (p.manager_id as string) || null,
    manager_name: userName(manager),
    manager_action_at: p.manager_action_at ? String(p.manager_action_at) : null,
    manager_remarks: (p.manager_remarks as string) || null,
    hr_reviewer_id: (p.hr_reviewer_id as string) || null,
    hr_reviewer_name: userName(hr),
    hr_reviewed_at: p.hr_reviewed_at ? String(p.hr_reviewed_at) : null,
    hr_remarks: (p.hr_remarks as string) || null,
    accounts_handler_id: (p.accounts_handler_id as string) || null,
    accounts_handler_name: userName(accounts),
    accounts_completed_at: p.accounts_completed_at ? String(p.accounts_completed_at) : null,
    accounts_remarks: (p.accounts_remarks as string) || null,
    payment_reference: (p.payment_reference as string) || null,
    change_request_remarks: (p.change_request_remarks as string) || null,
    change_requested_by: (p.change_requested_by as string) || null,
    created_at: p.created_at ? String(p.created_at) : '',
    total_amount: totals.total,
    total_in_words: totals.totalInWords,
    entry_count: totals.count,
  };
}

async function fetchWithTotals(row: Model): Promise<ReimbursementSheetRecord> {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const totals = await computeTotals(p.created_by as string, p.year as number, p.month as number);
  const full = await db.ReimbursementSheet.findByPk(p.id as string, { include: INCLUDE_USERS as never });
  return toRecord(full!, totals);
}

// Read-only counterpart to findOrCreate, for callers that only want to KNOW
// the sheet's status. findOrCreate writes, so using it to answer a question
// on a request that is about to be rejected (the change-requested carve-out
// in checkAddPeriod's callers) left an empty draft sheet behind for whatever
// month the rejected bill was dated — 2019-03, 2031-01, whatever was typed.
// A validation check must not create rows.
async function findForPeriod(userId: string, year: number, month: number): Promise<ReimbursementSheetRecord | null> {
  if (!isUuid(userId)) return null;
  const row = await db.ReimbursementSheet.findOne({
    where: { created_by: userId, year, month } as never,
    include: INCLUDE_USERS as never,
  });
  if (!row) return null;
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const totals = await computeTotals(p.created_by as string, year, month);
  return toRecord(row, totals);
}

async function findOrCreate(userId: string, year: number, month: number): Promise<ReimbursementSheetRecord> {
  const existing = await db.ReimbursementSheet.findOne({
    where: { created_by: userId, year, month } as never,
    include: INCLUDE_USERS as never,
  });

  if (existing) {
    const p = existing.get({ plain: true }) as Record<string, unknown>;
    const totals = await computeTotals(p.created_by as string, year, month);
    return toRecord(existing, totals);
  }

  const user = await db.User.findByPk(userId, { attributes: ['id', 'username', 'name', 'employeeId'] });
  if (!user) throw new Error('User not found');
  const up = user.get({ plain: true }) as Record<string, unknown>;
  const empId = (up.employeeId as string) || 'NA';
  const code = `REIMB-${empId}-${year}${String(month).padStart(2, '0')}`;

  const row = await db.ReimbursementSheet.create({
    created_by: userId,
    sheet_code: code,
    month,
    year,
    status: 'draft',
  } as never);

  return fetchWithTotals(row);
}

async function findById(id: string): Promise<ReimbursementSheetRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.ReimbursementSheet.findByPk(id, { include: INCLUDE_USERS as never });
  if (!row) return null;
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const totals = await computeTotals(p.created_by as string, p.year as number, p.month as number);
  return toRecord(row, totals);
}

async function listForReviewer(role: 'manager' | 'hr' | 'accounts', userId: string): Promise<ReimbursementSheetRecord[]> {
  let where: Record<string, unknown>;
  if (role === 'manager') {
    where = { status: { [Op.in]: ['submitted', 'manager_approved', 'manager_change_requested'] } };
  } else if (role === 'hr') {
    where = { status: { [Op.in]: ['manager_approved', 'hr_approved', 'hr_change_requested'] } };
  } else {
    where = { status: { [Op.in]: ['hr_approved', 'payment_done'] } };
  }

  const rows = await db.ReimbursementSheet.findAll({
    where: where as never,
    include: INCLUDE_USERS as never,
    order: [['year', 'DESC'], ['month', 'DESC'], ['created_at', 'ASC']],
  });

  const results: ReimbursementSheetRecord[] = [];
  for (const row of rows) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    const totals = await computeTotals(p.created_by as string, p.year as number, p.month as number);
    results.push(toRecord(row, totals));
  }
  return results;
}

// draft → submitted
async function submit(id: string): Promise<ReimbursementSheetRecord | null> {
  const row = await db.ReimbursementSheet.findByPk(id);
  if (!row) return null;
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const allowed: ReimbursementSheetStatus[] = ['draft', 'manager_change_requested', 'hr_change_requested'];
  if (!allowed.includes(p.status as ReimbursementSheetStatus)) return null;

  await row.update({ status: 'submitted', change_request_remarks: null, change_requested_by: null } as never);
  return fetchWithTotals(row);
}

// draft → manager_approved, skipping manager review entirely — for a sheet
// created by a department manager themselves. Manager fields stay null (no
// human manager actually reviewed it) rather than recording a fabricated
// self-approval; the UI's "Approved by Manager: ..." line only renders when
// manager_name is set, so this correctly shows nothing for that stage.
async function submitDirectToHr(id: string): Promise<ReimbursementSheetRecord | null> {
  const row = await db.ReimbursementSheet.findByPk(id);
  if (!row) return null;
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const allowed: ReimbursementSheetStatus[] = ['draft', 'manager_change_requested', 'hr_change_requested'];
  if (!allowed.includes(p.status as ReimbursementSheetStatus)) return null;

  await row.update({ status: 'manager_approved', change_request_remarks: null, change_requested_by: null } as never);
  return fetchWithTotals(row);
}

// submitted → manager_approved | manager_change_requested
async function managerDecide(
  id: string,
  decision: 'manager_approved' | 'manager_change_requested',
  actorId: string,
  remarks?: string
): Promise<ReimbursementSheetRecord | null> {
  const row = await db.ReimbursementSheet.findByPk(id);
  if (!row) return null;
  const p = row.get({ plain: true }) as Record<string, unknown>;
  if (p.status !== 'submitted') return null;

  const attrs: Record<string, unknown> = {
    status: decision,
    manager_id: actorId,
    manager_action_at: new Date(),
    manager_remarks: remarks || null,
  };
  if (decision === 'manager_change_requested') {
    attrs.change_request_remarks = remarks || null;
    attrs.change_requested_by = 'manager';
  }
  await row.update(attrs as never);
  return fetchWithTotals(row);
}

// manager_approved → hr_approved | hr_change_requested
async function hrDecide(
  id: string,
  decision: 'hr_approved' | 'hr_change_requested',
  actorId: string,
  remarks?: string
): Promise<ReimbursementSheetRecord | null> {
  const row = await db.ReimbursementSheet.findByPk(id);
  if (!row) return null;
  const p = row.get({ plain: true }) as Record<string, unknown>;
  if (p.status !== 'manager_approved') return null;

  const attrs: Record<string, unknown> = {
    status: decision,
    hr_reviewer_id: actorId,
    hr_reviewed_at: new Date(),
    hr_remarks: remarks || null,
  };
  if (decision === 'hr_change_requested') {
    attrs.change_request_remarks = remarks || null;
    attrs.change_requested_by = 'hr';
  }
  await row.update(attrs as never);
  return fetchWithTotals(row);
}

// hr_approved → payment_done
async function accountsComplete(
  id: string,
  actorId: string,
  paymentReference?: string,
  remarks?: string
): Promise<ReimbursementSheetRecord | null> {
  const row = await db.ReimbursementSheet.findByPk(id);
  if (!row) return null;
  const p = row.get({ plain: true }) as Record<string, unknown>;
  if (p.status !== 'hr_approved') return null;

  await row.update({
    status: 'payment_done',
    accounts_handler_id: actorId,
    accounts_completed_at: new Date(),
    accounts_remarks: remarks || null,
    payment_reference: paymentReference || null,
  } as never);
  return fetchWithTotals(row);
}

async function listActedOn(actorId: string): Promise<ReimbursementSheetRecord[]> {
  const rows = await db.ReimbursementSheet.findAll({
    where: {
      [Op.or]: [
        { manager_id: actorId },
        { hr_reviewer_id: actorId },
        { accounts_handler_id: actorId },
      ],
    } as never,
    include: INCLUDE_USERS as never,
    order: [['year', 'DESC'], ['month', 'DESC'], ['created_at', 'ASC']],
  });

  const results: ReimbursementSheetRecord[] = [];
  for (const row of rows) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    const totals = await computeTotals(p.created_by as string, p.year as number, p.month as number);
    results.push(toRecord(row, totals));
  }
  return results;
}

// Thrown inside the delete transaction when the sheet stopped being
// hr_approved while the request was in flight — rolls everything back.
class SheetStatusChangedError extends Error {}

// Statuses in which a claim is still the employee's to change. Once it is
// submitted, every entry is evidence an approver looked at, so editing or
// deleting one behind their back would change a total somebody already signed
// off. The two change-requested states are back in the employee's hands by
// design, which is how a correction gets made.
export const EDITABLE_SHEET_STATUSES: ReimbursementSheetStatus[] = ['draft', 'manager_change_requested', 'hr_change_requested'];

// What was destroyed, captured BEFORE the rows go, so the audit trail can
// still answer "whose claim, for how much, approved by whom" once nothing is
// left to look at.
export interface DeletedSheetSummary {
  sheetCode: string;
  employeeUsername: string;
  employeeName: string;
  employeeId: string;
  year: number;
  month: number;
  monthName: string;
  status: ReimbursementSheetStatus;
  entriesDeleted: number;
  totalAmount: number;
  managerName: string | null;
  hrReviewerName: string | null;
}

// Permanently removes an approved-but-unpaid claim: the sheet row AND the
// employee's own bill entries for that month. Both tables are paranoid:false,
// so destroy() is a real DELETE — there is no soft-deleted copy to recover
// from, which is exactly what was asked for.
//
// Two things it deliberately does NOT delete:
//   * is_admin_entry rows. They share the reimbursements table but belong to
//     the Admin Expenses module, carry their OWN approval/payment status, and
//     appear in the Accounts queue in their own right (lib/accountsPaymentStore.ts).
//     They are also split across several employees, so removing them here
//     would destroy another module's approved payment on someone else's
//     behalf. computeTotals already excludes them, so they were never part of
//     what this sheet claimed.
//   * the uploaded bill images in object storage. Orphaning a file is
//     recoverable; deleting the wrong one is not, and storage cleanup is not
//     what a finance correction should be reaching into.
//
// Authorisation and the status check belong to the caller (the route) — this
// function does what it is told, in one transaction so a half-deleted claim
// can never exist.
async function deleteSheetWithEntries(id: string): Promise<DeletedSheetSummary | null> {
  if (!isUuid(id)) return null;

  const row = await db.ReimbursementSheet.findByPk(id, { include: INCLUDE_USERS as never });
  if (!row) return null;
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const createdBy = p.created_by as string;
  const year = p.year as number;
  const month = p.month as number;
  const creator = p.creator as Record<string, unknown> | undefined;

  const totals = await computeTotals(createdBy, year, month);

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  let entriesDeleted = 0;
  try {
    await sequelize.transaction(async (t) => {
      entriesDeleted = await db.Reimbursement.destroy({
        where: {
          created_by: createdBy,
          date: { [Op.gte]: startDate, [Op.lt]: endDate },
          is_admin_entry: false
        } as never,
        transaction: t
      });
      // Conditional on the status STILL being hr_approved, not just on the id.
      // The route checked the status a few queries ago; in that window Accounts
      // can click Pay (accountsComplete does its own unlocked read-then-write),
      // and an unconditional destroy would then erase a payment that has
      // actually left the bank along with every bill backing it. Letting the
      // database decide the winner makes that impossible: if the row is no
      // longer hr_approved nothing matches, and throwing here rolls the entry
      // deletions back with it.
      const destroyed = await db.ReimbursementSheet.destroy({
        where: { id, status: 'hr_approved' } as never,
        transaction: t
      });
      if (!destroyed) throw new SheetStatusChangedError();
    });
  } catch (error) {
    if (error instanceof SheetStatusChangedError) return null;
    throw error;
  }

  return {
    sheetCode: (p.sheet_code as string) || '',
    employeeUsername: (creator?.username as string) || '',
    employeeName: (creator?.name as string) || (creator?.username as string) || '',
    employeeId: (creator?.employeeId as string) || '',
    year,
    month,
    monthName: MONTH_NAMES[month] || '',
    status: p.status as ReimbursementSheetStatus,
    entriesDeleted,
    totalAmount: totals.total,
    managerName: userName(p.manager as Record<string, unknown> | undefined),
    hrReviewerName: userName(p.hrReviewer as Record<string, unknown> | undefined)
  };
}

export const reimbursementSheetStore = {
  findOrCreate,
  findForPeriod,
  findById,
  deleteSheetWithEntries,
  listForReviewer,
  listActedOn,
  submit,
  submitDirectToHr,
  managerDecide,
  hrDecide,
  accountsComplete,
  MONTH_NAMES,
};
