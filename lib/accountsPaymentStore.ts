import { db, isUuid } from './db';
import { reimbursementSheetStore } from './reimbursementSheetStore';
import { tmsBomRequestStore } from './tmsBomRequestStore';
import { travelScheduleStore } from './travelScheduleStore';
import { monthKeyBounds } from './dateHelpers';
import { AdminExpenseSheetEntry, OfficeExpenseSheetEntry, PaymentQueueItem, PaymentSource, PaymentQueueStatus, PaymentSummary } from './types';

// A stated payment-SLA policy, not an asserted per-record fact — none of the
// 4 sources aggregated here has a real due-date field. Used only to compute
// Overdue/Due Today badges and sort priority; the UI labels it as a target,
// not a stored deadline. Change this one constant to retune the policy.
const PAYMENT_SLA_DAYS = 3;

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// A DB timestamp from a `.get({ plain: true })` row as an ISO string ('' if
// absent). Two traps it exists for: models defined with `underscored: true`
// (Reimbursement, OfficeOperationExpense) snake-case the timestamp COLUMNS
// but keep the ATTRIBUTE camelCase, so the plain row has `createdAt`, and
// `created_at` is undefined (see lib/officeOperationExpenseStore.ts's
// toRecord); and the value is a Date, whose String() form
// ("Mon Sep 21 2026 …") doesn't sort chronologically.
function isoOf(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function computeDueDate(approvedAt: string | null): string | null {
  if (!approvedAt) return null;
  return addDays(approvedAt, PAYMENT_SLA_DAYS);
}

const SOURCE_LABELS: Record<PaymentSource, string> = {
  reimbursement_sheet: 'Reimbursement',
  admin_expense: 'Admin Expense',
  office_expense: 'Office Operation Expense',
  bom_request: 'BOM Request',
  travel_schedule: 'Travel Booking'
};

function makePaymentId(source: PaymentSource, sourceId: string): string {
  return `${source}:${sourceId}`;
}

export function parsePaymentId(paymentId: string): { source: PaymentSource; sourceId: string } | null {
  const idx = paymentId.indexOf(':');
  if (idx < 0) return null;
  const source = paymentId.slice(0, idx) as PaymentSource;
  const sourceId = paymentId.slice(idx + 1);
  if (!sourceId || !(source in SOURCE_LABELS)) return null;
  return { source, sourceId };
}

// ---------- Active-hold overlay ----------

interface HoldInfo {
  reason: string;
  heldAt: string;
}

async function loadActiveHolds(): Promise<Map<string, HoldInfo>> {
  const rows = await db.PaymentHold.findAll({ where: { active: true } as never });
  const map = new Map<string, HoldInfo>();
  for (const row of rows) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    map.set(`${p.source}:${p.source_id}`, { reason: p.reason as string, heldAt: String(p.held_at) });
  }
  return map;
}

function applyHold(item: PaymentQueueItem, holds: Map<string, HoldInfo>): PaymentQueueItem {
  if (item.status === 'paid') return item;
  const hold = holds.get(item.paymentId);
  if (!hold) return item;
  return { ...item, status: 'on_hold', holdReason: hold.reason };
}

// ---------- Per-source builders ----------

async function getReimbursementSheetItems(): Promise<PaymentQueueItem[]> {
  const sheets = await reimbursementSheetStore.listForReviewer('accounts', '');
  return sheets.map((s) => {
    const status: PaymentQueueStatus = s.status === 'payment_done' ? 'paid' : 'payment_required';
    return {
      paymentId: makePaymentId('reimbursement_sheet', s.id),
      source: 'reimbursement_sheet',
      sourceId: s.id,
      sourceLabel: SOURCE_LABELS.reimbursement_sheet,
      payee: s.creator_name,
      description: `Reimbursement — ${reimbursementSheetStore.MONTH_NAMES[s.month] || ''} ${s.year} (${s.sheet_code})`,
      amount: s.total_amount,
      department: s.creator_department,
      requestedBy: s.creator_name,
      approvedBy: s.hr_reviewer_name || '',
      approvedAt: s.hr_reviewed_at,
      dueDate: computeDueDate(s.hr_reviewed_at),
      status,
      paidAt: s.accounts_completed_at,
      paidBy: s.accounts_handler_name,
      paymentMethod: null,
      paymentReference: s.payment_reference,
      holdReason: null,
      createdAt: s.created_at
    };
  });
}

// ---------- Admin Expense: one sheet per calendar month ----------
//
// Grouped the same way, and for the same reason, as Office Operation
// Expense below: Accounts pays these monthly, not one row per "add expense"
// action. A "batch" (Reimbursement.admin_note — several employees split in
// one add/edit action) still exists as the unit of entry and approval (see
// lib/adminExpenseAccess.ts), but is no longer the unit of payment — several
// batches logged in the same month settle together as one sheet, same as
// several individually-logged Office Operation Expense entries do.
//
// Unlike Office Operation Expense, a row here isn't payable purely by virtue
// of existing — approval_status='approved' is required too (a batch a
// designated approver hasn't signed off on yet is not Accounts' to act on),
// even though payment_status is already 'payment_required' at creation
// regardless of approval state. And the per-row amount to sum is `amount`
// (this row's own split), never `admin_total_amount` (the whole batch's
// total, repeated identically on every row in it — summing that across a
// month would multiply-count every multi-employee batch).

async function loadAdminExpenseSheets(): Promise<AdminExpenseSheet[]> {
  const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };
  const rows = await db.Reimbursement.findAll({
    where: { is_admin_entry: true, payment_status: { [Op.in]: ['payment_required', 'paid'] }, approval_status: 'approved' } as never,
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }] as never,
    order: [['date', 'ASC'], ['created_at', 'ASC']]
  });
  const plains = rows.map((row) => row.get({ plain: true }) as Record<string, unknown>);
  const paidByIds = [...new Set(plains.map((p) => p.paid_by as string).filter(Boolean))];
  return groupAdminExpenseRows(plains, await resolveUserNames(paidByIds));
}

export interface AdminExpenseSheet {
  item: PaymentQueueItem;
  entries: AdminExpenseSheetEntry[];
}

// Pure — same shape/reasoning as groupOfficeExpenseRows below, so the
// grouping rules can be unit-tested without a database.
export function groupAdminExpenseRows(rows: Record<string, unknown>[], paidByNames: Map<string, string>): AdminExpenseSheet[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const month = String(row.date || '').slice(0, 7);
    if (!monthKeyBounds(month)) continue;
    const key = row.payment_status === 'paid'
      ? `${month}~${row.paid_at ? new Date(isoOf(row.paid_at)).getTime() : 'legacy'}`
      : month;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  const sheets: AdminExpenseSheet[] = [];
  for (const [key, groupRows] of groups) {
    const month = key.slice(0, 7);
    const first = groupRows[0];
    const employeeNames: string[] = [];
    for (const row of groupRows) {
      const creator = row.creator as Record<string, unknown> | undefined;
      const name = (creator?.name as string) || (creator?.username as string) || '';
      if (name && !employeeNames.includes(name)) employeeNames.push(name);
    }
    // The sheet is as urgent as its oldest waiting entry — same rule as
    // Office Operation Expense's sheet below.
    const earliestCreatedAt = groupRows
      .map((row) => isoOf(row.createdAt ?? row.created_at))
      .filter(Boolean)
      .sort()[0] || '';
    const amount = Math.round(groupRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100;
    const count = groupRows.length;
    const people = employeeNames.join(', ') || '—';
    const status: PaymentQueueStatus = first.payment_status === 'paid' ? 'paid' : 'payment_required';

    sheets.push({
      item: {
        paymentId: makePaymentId('admin_expense', key),
        source: 'admin_expense',
        sourceId: key,
        sourceLabel: SOURCE_LABELS.admin_expense,
        payee: people,
        description: `Admin Expense — ${monthLabel(month)} (${count} entr${count === 1 ? 'y' : 'ies'})`,
        amount,
        department: '',
        // No separate "who entered this" field exists on Admin Expense rows
        // — created_by is the beneficiary employee, not the admin/HR staff
        // who logged it (see app/api/admin-expenses/route.ts), and there's
        // no approval-by-name captured either. The employee list is the
        // only identity data genuinely available here.
        requestedBy: people,
        approvedBy: '',
        approvedAt: earliestCreatedAt || null,
        dueDate: computeDueDate(earliestCreatedAt || null),
        status,
        paidAt: isoOf(first.paid_at) || null,
        paidBy: first.paid_by ? paidByNames.get(first.paid_by as string) || null : null,
        paymentMethod: (first.payment_method as string) || null,
        paymentReference: (first.payment_reference as string) || null,
        holdReason: null,
        createdAt: earliestCreatedAt
      },
      entries: groupRows.map((row) => {
        const creator = row.creator as Record<string, unknown> | undefined;
        return {
          id: row.id as string,
          date: String(row.date || ''),
          expenseType: (row.description as string) || '',
          amount: Number(row.amount) || 0,
          employeeName: (creator?.name as string) || (creator?.username as string) || ''
        };
      })
    });
  }
  return sheets;
}

async function getAdminExpenseItems(): Promise<PaymentQueueItem[]> {
  return (await loadAdminExpenseSheets()).map((sheet) => sheet.item);
}

// Line items for one sheet's detail view — null if no such sheet exists.
export async function getAdminExpenseSheetEntries(sheetKey: string): Promise<AdminExpenseSheetEntry[] | null> {
  const sheet = (await loadAdminExpenseSheets()).find((s) => s.item.sourceId === sheetKey);
  return sheet ? sheet.entries : null;
}

// ---------- Office Operation Expenses: one sheet per calendar month ----------
//
// Paid to Accounts as a monthly sheet, the same unit the Office Operation
// Expense module itself works in (its register, month total, and Excel
// export are all per month) — not one queue row per line item, which is how
// Reimbursement is already presented too (one sheet per employee per month).
//
// Unpaid entries for a month form ONE payable sheet, keyed by the bare month
// ('2026-09'). Paid entries are grouped by month + the payment they were
// settled in ('2026-09~<paid_at ms>', or '~legacy' for rows backfilled as
// already-paid before the Accounts step existed), so a month settled in two
// separate payments shows as two history rows instead of one blended one.
// Only the bare-month key is ever actionable (pay/hold/resume) — see
// payOfficeExpenseSheet.

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_LABELS[Number(month) - 1] || month} ${year}`;
}

export interface OfficeExpenseSheet {
  item: PaymentQueueItem;
  entries: OfficeExpenseSheetEntry[];
  requesterUsernames: string[];
}

// Pure — takes already-fetched plain rows (with their `creator` include) so
// the grouping rules can be unit-tested without a database.
export function groupOfficeExpenseRows(rows: Record<string, unknown>[], paidByNames: Map<string, string>): OfficeExpenseSheet[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const month = String(row.date || '').slice(0, 7);
    if (!monthKeyBounds(month)) continue;
    const key = row.payment_status === 'paid'
      ? `${month}~${row.paid_at ? new Date(isoOf(row.paid_at)).getTime() : 'legacy'}`
      : month;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  const sheets: OfficeExpenseSheet[] = [];
  for (const [key, groupRows] of groups) {
    const month = key.slice(0, 7);
    const first = groupRows[0];
    const creatorNames: string[] = [];
    const requesterUsernames: string[] = [];
    for (const row of groupRows) {
      const creator = row.creator as Record<string, unknown> | undefined;
      const name = (creator?.name as string) || (creator?.username as string) || '';
      if (name && !creatorNames.includes(name)) creatorNames.push(name);
      const username = creator?.username as string | undefined;
      if (username && !requesterUsernames.includes(username)) requesterUsernames.push(username);
    }
    // The sheet is as urgent as its oldest waiting entry — an entry logged
    // on the 1st is no less overdue for having a later one join its sheet.
    const earliestCreatedAt = groupRows
      .map((row) => isoOf(row.createdAt ?? row.created_at))
      .filter(Boolean)
      .sort()[0] || '';
    const amount = Math.round(groupRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100;
    const count = groupRows.length;
    const people = creatorNames.join(', ') || '—';
    const status: PaymentQueueStatus = first.payment_status === 'paid' ? 'paid' : 'payment_required';

    sheets.push({
      item: {
        paymentId: makePaymentId('office_expense', key),
        source: 'office_expense',
        sourceId: key,
        sourceLabel: SOURCE_LABELS.office_expense,
        payee: people,
        description: `Office Operation Expenses — ${monthLabel(month)} (${count} entr${count === 1 ? 'y' : 'ies'})`,
        amount,
        department: '',
        requestedBy: people,
        // No approval step exists for this module — HR/Admin-only creation
        // is itself the implicit approval, so this is the entries' own
        // creators, not a fabricated separate approval event.
        approvedBy: people,
        approvedAt: earliestCreatedAt || null,
        dueDate: computeDueDate(earliestCreatedAt || null),
        status,
        paidAt: isoOf(first.paid_at) || null,
        paidBy: first.paid_by ? paidByNames.get(first.paid_by as string) || null : null,
        paymentMethod: (first.payment_method as string) || null,
        paymentReference: (first.payment_reference as string) || null,
        holdReason: null,
        createdAt: earliestCreatedAt
      },
      entries: groupRows.map((row) => {
        const creator = row.creator as Record<string, unknown> | undefined;
        return {
          id: row.id as string,
          date: String(row.date || ''),
          usecase: (row.usecase as string) || '',
          usecaseDetail: (row.usecase_detail as string) || '',
          itemName: (row.item_name as string) || '',
          itemSubNames: Array.isArray(row.item_sub_names) ? (row.item_sub_names as string[]) : [],
          itemQty: row.item_qty === null || row.item_qty === undefined ? null : Number(row.item_qty),
          amount: Number(row.amount) || 0,
          description: (row.description as string) || '',
          remarks: (row.remarks as string) || '',
          createdBy: (creator?.name as string) || (creator?.username as string) || ''
        };
      }),
      requesterUsernames
    });
  }
  return sheets;
}

async function loadOfficeExpenseSheets(): Promise<OfficeExpenseSheet[]> {
  const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };
  const rows = await db.OfficeOperationExpense.findAll({
    where: { payment_status: { [Op.in]: ['payment_required', 'paid'] } } as never,
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }] as never,
    order: [['date', 'ASC'], ['created_at', 'ASC']]
  });
  const plains = rows.map((row) => row.get({ plain: true }) as Record<string, unknown>);
  const paidByIds = [...new Set(plains.map((p) => p.paid_by as string).filter(Boolean))];
  return groupOfficeExpenseRows(plains, await resolveUserNames(paidByIds));
}

async function getOfficeExpenseItems(): Promise<PaymentQueueItem[]> {
  return (await loadOfficeExpenseSheets()).map((sheet) => sheet.item);
}

// Line items for one sheet's detail view — null if no such sheet exists.
export async function getOfficeExpenseSheetEntries(sheetKey: string): Promise<OfficeExpenseSheetEntry[] | null> {
  const sheet = (await loadOfficeExpenseSheets()).find((s) => s.item.sourceId === sheetKey);
  return sheet ? sheet.entries : null;
}

async function getBomRequestItems(): Promise<PaymentQueueItem[]> {
  const all = await tmsBomRequestStore.list();
  return all
    .filter((r) => r.status === 'finance_approved' || r.status === 'payment_done')
    .map((r) => {
      const status: PaymentQueueStatus = r.status === 'payment_done' ? 'paid' : 'payment_required';
      return {
        paymentId: makePaymentId('bom_request', r.id),
        source: 'bom_request',
        sourceId: r.id,
        sourceLabel: SOURCE_LABELS.bom_request,
        // No vendor field exists on TmsBomRequest itself (vendor only lives
        // on the separate TmsProcurement record for the procurement fork,
        // which this queue doesn't cover) — the requester is the closest
        // real "who does this concern" identity available.
        payee: r.requested_by_name,
        description: `${r.item_name} — ${r.project_name} (${r.bom_request_code})`,
        amount: r.estimated_cost,
        department: r.department_name,
        requestedBy: r.requested_by_name,
        approvedBy: r.finance_reviewed_by_name,
        approvedAt: r.finance_reviewed_at || null,
        dueDate: computeDueDate(r.finance_reviewed_at || null),
        status,
        paidAt: r.payment_marked_at || null,
        paidBy: r.payment_marked_by_name || null,
        paymentMethod: null,
        paymentReference: null,
        holdReason: null,
        createdAt: r.created_at
      };
    });
}

async function getTravelScheduleItems(): Promise<PaymentQueueItem[]> {
  const all = await travelScheduleStore.list('', true);
  return all
    .filter((r) => r.status === 'admin_approved' || r.status === 'ticket_booking')
    .map((r) => {
      const status: PaymentQueueStatus = r.status === 'ticket_booking' ? 'paid' : 'payment_required';
      return {
        paymentId: makePaymentId('travel_schedule', r.id),
        source: 'travel_schedule',
        sourceId: r.id,
        sourceLabel: SOURCE_LABELS.travel_schedule,
        payee: r.created_by,
        description: `Travel — ${r.origin} → ${r.destination} (${r.request_code})`,
        amount: r.actual_cost || r.estimated_cost || 0,
        department: '',
        requestedBy: r.created_by,
        approvedBy: r.admin_reviewer_name,
        approvedAt: r.admin_reviewed_at || null,
        dueDate: computeDueDate(r.admin_reviewed_at || null),
        status,
        paidAt: r.accounts_completed_at || null,
        paidBy: r.accounts_handler_name || null,
        paymentMethod: r.booking_details || null,
        paymentReference: null,
        holdReason: null,
        createdAt: r.created_at
      };
    });
}

async function resolveUserNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = await db.User.findAll({ where: { id: ids } as never, attributes: ['id', 'name', 'username'] });
  for (const row of rows) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    map.set(p.id as string, (p.name as string) || (p.username as string) || '');
  }
  return map;
}

// ---------- Aggregation ----------

export async function getAllPaymentItems(): Promise<PaymentQueueItem[]> {
  const [sheets, adminExpenses, officeExpenses, bomRequests, travel, holds] = await Promise.all([
    getReimbursementSheetItems(),
    getAdminExpenseItems(),
    getOfficeExpenseItems(),
    getBomRequestItems(),
    getTravelScheduleItems(),
    loadActiveHolds()
  ]);
  const all = [...sheets, ...adminExpenses, ...officeExpenses, ...bomRequests, ...travel];
  return all.map((item) => applyHold(item, holds));
}

// overdue -> due today -> due soon -> older -> future, oldest-first within
// the same bucket (Part 23).
function priorityBucket(item: PaymentQueueItem, now: number): number {
  if (!item.dueDate) return 3;
  const due = new Date(item.dueDate).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (due < now - oneDay) return 0; // overdue (past the SLA target by more than a day)
  if (due <= now + oneDay) return 1; // due today/imminent
  if (due <= now + 3 * oneDay) return 2; // due soon
  return 3; // older/future — sorted by age below regardless
}

export function sortPaymentQueue(items: PaymentQueueItem[]): PaymentQueueItem[] {
  const now = Date.now();
  return [...items].sort((a, b) => {
    const pa = priorityBucket(a, now);
    const pb = priorityBucket(b, now);
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function computeSummary(items: PaymentQueueItem[]): PaymentSummary {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  let pendingCount = 0;
  let pendingAmount = 0;
  let dueTodayAmount = 0;
  let overdueAmount = 0;
  let paidThisMonthAmount = 0;

  for (const item of items) {
    if (item.status === 'payment_required' || item.status === 'on_hold') {
      pendingCount++;
      pendingAmount += item.amount;
      if (item.dueDate) {
        const due = new Date(item.dueDate).getTime();
        if (due < now - oneDay) overdueAmount += item.amount;
        else if (due <= now + oneDay) dueTodayAmount += item.amount;
      }
    } else if (item.status === 'paid' && item.paidAt) {
      if (new Date(item.paidAt).getTime() >= monthStart.getTime()) paidThisMonthAmount += item.amount;
    }
  }

  return { pendingCount, pendingAmount, dueTodayAmount, overdueAmount, paidThisMonthAmount };
}

export async function findPaymentItem(paymentId: string): Promise<PaymentQueueItem | null> {
  const parsed = parsePaymentId(paymentId);
  if (!parsed) return null;
  const items = await getAllPaymentItems();
  return items.find((i) => i.paymentId === paymentId) || null;
}

// ---------- Actions ----------

export interface PayInput {
  paymentMethod: string;
  paymentDate: string;
  paymentReference: string;
  remarks?: string;
  proofUrls?: string[];
  // The total the Accounts user was shown when they confirmed. Only
  // enforced where a payable item's amount can grow after it's displayed —
  // an Admin Expense or Office Operation Expense sheet absorbs any new
  // entry logged for that month, so paying without this check could settle
  // an amount the payer never actually saw.
  expectedAmount?: number;
}

export type PayResult = { ok: true } | { ok: false; error: string };

// Dispatches to the right source's own pay action. The 3 sources that
// already had one (Reimbursement Sheet, BOM Request, Travel Schedule) reuse
// their existing store functions verbatim — no reimplementation, no
// duplicated business logic. Only Admin Expense and Office Operation
// Expense get a genuinely new write path here, since neither had one.
export async function payItem(
  source: PaymentSource,
  sourceId: string,
  actor: { id: string; username: string },
  input: PayInput
): Promise<PayResult> {
  switch (source) {
    case 'reimbursement_sheet': {
      const sheet = await reimbursementSheetStore.findById(sourceId);
      if (!sheet) return { ok: false, error: 'Reimbursement sheet not found' };
      if (sheet.status !== 'hr_approved') return { ok: false, error: 'This sheet is not awaiting payment' };
      const updated = await reimbursementSheetStore.accountsComplete(sourceId, actor.id, input.paymentReference, input.remarks);
      return updated ? { ok: true } : { ok: false, error: 'Payment could not be completed — it may already be paid' };
    }
    case 'bom_request': {
      const rows = await tmsBomRequestStore.list();
      const existing = rows.find((r) => r.id === sourceId);
      if (!existing) return { ok: false, error: 'BOM request not found' };
      if (existing.status !== 'finance_approved') return { ok: false, error: 'This request is not awaiting payment' };
      const proofUrls = input.proofUrls && input.proofUrls.length ? input.proofUrls : [];
      if (!proofUrls.length) return { ok: false, error: 'Payment proof is required for a BOM request payment' };
      const updated = await tmsBomRequestStore.markPaymentDone(sourceId, actor.username, proofUrls);
      return updated ? { ok: true } : { ok: false, error: 'Payment could not be completed — it may already be paid' };
    }
    case 'travel_schedule': {
      const existing = await travelScheduleStore.findById(sourceId);
      if (!existing) return { ok: false, error: 'Travel request not found' };
      if (existing.status !== 'admin_approved') return { ok: false, error: 'This request is not ready for booking/payment' };
      const updated = await travelScheduleStore.completeBooking(sourceId, actor.username, {
        booking_details: input.paymentReference || input.remarks || '',
        ticket_documents: input.proofUrls || [],
        actual_cost: undefined
      });
      return updated ? { ok: true } : { ok: false, error: 'Payment could not be completed — it may already be paid' };
    }
    case 'admin_expense':
      return payAdminExpenseSheet(sourceId, actor, input);
    case 'office_expense':
      return payOfficeExpenseSheet(sourceId, actor, input);
    default:
      return { ok: false, error: 'Unknown payment source' };
  }
}

// Settles every unpaid, approved entry in one month together — same
// row-locked, expectedAmount-checked transaction as payOfficeExpenseSheet
// below, for the same concurrency reasons. approval_status='approved' is
// part of the WHERE clause (not just a display filter) so a batch still
// pending sign-off can never be swept into a month's payment even if its
// date falls inside it.
async function payAdminExpenseSheet(sheetKey: string, actor: { id: string }, input: PayInput): Promise<PayResult> {
  const bounds = monthKeyBounds(sheetKey);
  if (!bounds) return { ok: false, error: 'This sheet is not awaiting payment' };
  const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };

  return db.sequelize.transaction(async (t) => {
    const rows = await db.Reimbursement.findAll({
      where: {
        is_admin_entry: true, approval_status: 'approved', payment_status: 'payment_required',
        date: { [Op.gte]: bounds.from, [Op.lt]: bounds.to }
      } as never,
      attributes: ['id', 'amount'],
      lock: t.LOCK.UPDATE,
      transaction: t
    });
    if (!rows.length) return { ok: false, error: 'This sheet is not awaiting payment — it may already be paid or not yet approved' } as PayResult;

    const total = Math.round(rows.reduce((sum, row) => sum + (Number(row.get('amount')) || 0), 0) * 100) / 100;
    if (input.expectedAmount !== undefined && Math.abs(total - input.expectedAmount) > 0.005) {
      return {
        ok: false,
        error: `This sheet changed since you opened it — it now totals ₹${total.toLocaleString('en-IN')}. Refresh and review it before paying.`
      } as PayResult;
    }

    await db.Reimbursement.update(
      {
        payment_status: 'paid',
        paid_at: input.paymentDate ? new Date(input.paymentDate) : new Date(),
        paid_by: actor.id,
        payment_method: input.paymentMethod || null,
        payment_reference: input.paymentReference || null,
        payment_proof_urls: input.proofUrls || []
      } as never,
      { where: { id: rows.map((row) => row.get('id')), payment_status: 'payment_required' } as never, transaction: t }
    );
    return { ok: true } as PayResult;
  });
}

// Settles every unpaid entry in one month's sheet together. Row-locked in a
// transaction so the set that gets totalled is exactly the set that gets
// marked paid: a concurrent second pay attempt blocks, then finds nothing
// left to pay; an entry HR logs mid-payment either lands before the lock
// (and trips the expectedAmount check) or after it (and starts a fresh
// unpaid sheet for that month).
async function payOfficeExpenseSheet(sheetKey: string, actor: { id: string }, input: PayInput): Promise<PayResult> {
  // Paid history groups ('2026-09~...') are never payable — only the bare
  // month key of an unpaid sheet is.
  const bounds = monthKeyBounds(sheetKey);
  if (!bounds) return { ok: false, error: 'This sheet is not awaiting payment' };
  const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };

  return db.sequelize.transaction(async (t) => {
    const rows = await db.OfficeOperationExpense.findAll({
      where: { payment_status: 'payment_required', date: { [Op.gte]: bounds.from, [Op.lt]: bounds.to } } as never,
      attributes: ['id', 'amount'],
      lock: t.LOCK.UPDATE,
      transaction: t
    });
    if (!rows.length) return { ok: false, error: 'This sheet is not awaiting payment — it may already be paid' } as PayResult;

    const total = Math.round(rows.reduce((sum, row) => sum + (Number(row.get('amount')) || 0), 0) * 100) / 100;
    if (input.expectedAmount !== undefined && Math.abs(total - input.expectedAmount) > 0.005) {
      return {
        ok: false,
        error: `This sheet changed since you opened it — it now totals ₹${total.toLocaleString('en-IN')}. Refresh and review it before paying.`
      } as PayResult;
    }

    await db.OfficeOperationExpense.update(
      {
        payment_status: 'paid',
        paid_at: input.paymentDate ? new Date(input.paymentDate) : new Date(),
        paid_by: actor.id,
        payment_method: input.paymentMethod || null,
        payment_reference: input.paymentReference || null,
        payment_proof_urls: input.proofUrls || []
      } as never,
      { where: { id: rows.map((row) => row.get('id')), payment_status: 'payment_required' } as never, transaction: t }
    );
    return { ok: true } as PayResult;
  });
}

export async function holdPayment(source: PaymentSource, sourceId: string, actorId: string, reason: string): Promise<PayResult> {
  const item = await findPaymentItem(makePaymentId(source, sourceId));
  if (!item) return { ok: false, error: 'Payment not found' };
  if (item.status === 'paid') return { ok: false, error: 'This payment is already paid' };
  if (item.status === 'on_hold') return { ok: false, error: 'This payment is already on hold' };
  try {
    await db.PaymentHold.create({ source, source_id: sourceId, reason, held_by: actorId, held_at: new Date(), active: true } as never);
    return { ok: true };
  } catch (error) {
    // The partial unique index (source, source_id) WHERE active — the
    // concurrency guard against two simultaneous "Put On Hold" clicks.
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') {
      return { ok: false, error: 'This payment is already on hold' };
    }
    throw error;
  }
}

// The real row UUID(s) a payment acts on, for audit logs and notifications.
// audit_logs.entity_id and notifications.entityId are both UUID columns, and
// both writers (logAudit, notifyUsers) swallow insert errors — so logging
// against an Admin Expense or Office sheet's month key ('2026-09') doesn't
// error, it just silently records nothing. Resolve BEFORE acting: paying a
// sheet moves its entries into a paid group, after which the bare month key
// no longer finds them.
export async function resolveEntityIds(source: PaymentSource, sourceId: string): Promise<string[]> {
  switch (source) {
    case 'admin_expense': {
      const sheet = (await loadAdminExpenseSheets()).find((s) => s.item.sourceId === sourceId);
      return sheet ? sheet.entries.map((entry) => entry.id) : [];
    }
    case 'office_expense': {
      const sheet = (await loadOfficeExpenseSheets()).find((s) => s.item.sourceId === sourceId);
      return sheet ? sheet.entries.map((entry) => entry.id) : [];
    }
    default:
      return isUuid(sourceId) ? [sourceId] : [];
  }
}

// Best-effort — used only to address the Part 18 hold/resume notification
// to whoever originally requested the underlying record. A list, not a
// single user: an Office Operation Expense monthly sheet can hold entries
// logged by several HR/Admin staff, and each of them should hear that
// their entry's payment is held. Admin Expense has no requester at all
// (it's a batch of beneficiary employees — see getAdminExpenseItems above),
// so that notification is simply skipped for that source.
export async function resolveRequesterUsernames(source: PaymentSource, sourceId: string): Promise<string[]> {
  switch (source) {
    case 'reimbursement_sheet': {
      const sheet = await reimbursementSheetStore.findById(sourceId);
      return sheet?.created_by ? [sheet.created_by] : [];
    }
    case 'office_expense': {
      const sheet = (await loadOfficeExpenseSheets()).find((s) => s.item.sourceId === sourceId);
      return sheet ? sheet.requesterUsernames : [];
    }
    case 'bom_request': {
      const rows = await tmsBomRequestStore.list();
      const existing = rows.find((r) => r.id === sourceId);
      if (!existing?.requested_by_id) return [];
      const user = await db.User.findByPk(existing.requested_by_id, { attributes: ['username'] });
      const username = user ? ((user.get({ plain: true }) as Record<string, unknown>).username as string) : '';
      return username ? [username] : [];
    }
    case 'travel_schedule': {
      const existing = await travelScheduleStore.findById(sourceId);
      return existing?.created_by ? [existing.created_by] : [];
    }
    default:
      return [];
  }
}

export async function resumePayment(source: PaymentSource, sourceId: string, actorId: string): Promise<PayResult> {
  const [affectedCount] = await db.PaymentHold.update(
    { active: false, resumed_by: actorId, resumed_at: new Date() } as never,
    { where: { source, source_id: sourceId, active: true } as never }
  );
  if (!affectedCount) return { ok: false, error: 'No active hold found for this payment' };
  return { ok: true };
}

export { SOURCE_LABELS };
