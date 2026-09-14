import { db, isUuid } from './db';
import { reimbursementSheetStore } from './reimbursementSheetStore';
import { tmsBomRequestStore } from './tmsBomRequestStore';
import { travelScheduleStore } from './travelScheduleStore';
import { officeOperationExpenseStore } from './officeOperationExpenseStore';
import { PaymentQueueItem, PaymentSource, PaymentQueueStatus, PaymentSummary } from './types';

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

interface AdminExpenseBatch {
  batchId: string;
  date: string;
  description: string;
  total_amount: number;
  payment_status: string | null;
  paid_at: string | null;
  paid_by_name: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  employees: string[];
  created_at: string;
}

async function getAdminExpenseItems(): Promise<PaymentQueueItem[]> {
  const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };
  const rows = await db.Reimbursement.findAll({
    // approval_status='approved' required — a batch a designated approver
    // (see lib/adminExpenseAccess.ts) hasn't signed off on yet is not
    // Accounts' to act on (Part 12: "source request is approved where
    // approval is required"), even though payment_status is already
    // 'payment_required' at creation time regardless of approval state.
    where: { is_admin_entry: true, payment_status: { [Op.in]: ['payment_required', 'paid'] }, approval_status: 'approved' } as never,
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }] as never,
    order: [['created_at', 'DESC']]
  });

  const batches = new Map<string, AdminExpenseBatch>();
  const paidByIds = new Set<string>();
  for (const row of rows) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    const batchId = (p.admin_note as string) || (p.id as string);
    if (!batches.has(batchId)) {
      batches.set(batchId, {
        batchId,
        date: p.date ? String(p.date) : '',
        description: (p.description as string) || '',
        total_amount: Number(p.admin_total_amount) || 0,
        payment_status: (p.payment_status as string) || null,
        paid_at: p.paid_at ? String(p.paid_at) : null,
        paid_by_name: null,
        payment_method: (p.payment_method as string) || null,
        payment_reference: (p.payment_reference as string) || null,
        employees: [],
        created_at: p.created_at ? String(p.created_at) : ''
      });
    }
    const batch = batches.get(batchId)!;
    const creator = p.creator as Record<string, unknown> | undefined;
    if (creator) batch.employees.push((creator.name as string) || (creator.username as string) || '');
    if (p.paid_by) paidByIds.add(p.paid_by as string);
  }

  const paidByMap = await resolveUserNames([...paidByIds]);
  for (const row of rows) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    const batchId = (p.admin_note as string) || (p.id as string);
    const batch = batches.get(batchId)!;
    if (p.paid_by && !batch.paid_by_name) batch.paid_by_name = paidByMap.get(p.paid_by as string) || null;
  }

  return [...batches.values()].map((b) => {
    const status: PaymentQueueStatus = b.payment_status === 'paid' ? 'paid' : 'payment_required';
    return {
      paymentId: makePaymentId('admin_expense', b.batchId),
      source: 'admin_expense',
      sourceId: b.batchId,
      sourceLabel: SOURCE_LABELS.admin_expense,
      payee: b.employees.join(', ') || '—',
      description: `${b.description} — split across ${b.employees.length} employee${b.employees.length === 1 ? '' : 's'}`,
      amount: b.total_amount,
      department: '',
      // No separate "who entered this batch" field exists on Admin Expense
      // rows — created_by is the beneficiary employee, not the admin/HR
      // staff who logged it (see app/api/admin-expenses/route.ts). The
      // employee list is the only identity data genuinely available here.
      requestedBy: b.employees.join(', ') || '—',
      approvedBy: '',
      approvedAt: b.created_at,
      dueDate: computeDueDate(b.created_at),
      status,
      paidAt: b.paid_at,
      paidBy: b.paid_by_name,
      paymentMethod: b.payment_method,
      paymentReference: b.payment_reference,
      holdReason: null,
      createdAt: b.created_at
    };
  });
}

async function getOfficeExpenseItems(): Promise<PaymentQueueItem[]> {
  const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };
  const rows = await db.OfficeOperationExpense.findAll({
    where: { payment_status: { [Op.in]: ['payment_required', 'paid'] } } as never,
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }] as never,
    order: [['created_at', 'DESC']]
  });

  const paidByIds = new Set<string>();
  const plains = rows.map((row) => row.get({ plain: true }) as Record<string, unknown>);
  plains.forEach((p) => { if (p.paid_by) paidByIds.add(p.paid_by as string); });
  const paidByMap = await resolveUserNames([...paidByIds]);

  return plains.map((p) => {
    const creator = p.creator as Record<string, unknown> | undefined;
    const creatorName = (creator?.name as string) || (creator?.username as string) || '';
    const createdAt = p.created_at ? String(p.created_at) : '';
    const status: PaymentQueueStatus = p.payment_status === 'paid' ? 'paid' : 'payment_required';
    return {
      paymentId: makePaymentId('office_expense', p.id as string),
      source: 'office_expense',
      sourceId: p.id as string,
      sourceLabel: SOURCE_LABELS.office_expense,
      payee: creatorName,
      description: `${p.usecase as string}${p.item_name ? ' — ' + p.item_name : ''}`,
      amount: Number(p.amount) || 0,
      department: '',
      requestedBy: creatorName,
      // Office Operation Expenses have no approval step (HR/Admin-only
      // creation is itself the implicit approval) — approvedAt is the
      // creation date, not a fabricated separate approval event.
      approvedBy: creatorName,
      approvedAt: createdAt,
      dueDate: computeDueDate(createdAt),
      status,
      paidAt: p.paid_at ? String(p.paid_at) : null,
      paidBy: p.paid_by ? paidByMap.get(p.paid_by as string) || null : null,
      paymentMethod: (p.payment_method as string) || null,
      paymentReference: (p.payment_reference as string) || null,
      holdReason: null,
      createdAt
    };
  });
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
      return payAdminExpenseBatch(sourceId, actor, input);
    case 'office_expense':
      return payOfficeExpense(sourceId, actor, input);
    default:
      return { ok: false, error: 'Unknown payment source' };
  }
}

async function payAdminExpenseBatch(batchId: string, actor: { id: string }, input: PayInput): Promise<PayResult> {
  const [affectedCount] = await db.Reimbursement.update(
    {
      payment_status: 'paid',
      paid_at: input.paymentDate ? new Date(input.paymentDate) : new Date(),
      paid_by: actor.id,
      payment_method: input.paymentMethod || null,
      payment_reference: input.paymentReference || null,
      payment_proof_urls: input.proofUrls || []
    } as never,
    // The WHERE clause doubling as the eligibility+duplicate-payment guard:
    // this only touches rows still 'payment_required' AND already
    // approved, so a second concurrent pay attempt, or a direct API call
    // against a not-yet-approved batch, affects 0 rows instead of
    // incorrectly recording payment.
    { where: { admin_note: batchId, is_admin_entry: true, payment_status: 'payment_required', approval_status: 'approved' } as never }
  );
  if (!affectedCount) return { ok: false, error: 'This batch is not awaiting payment — it may already be paid, not yet approved, or not found' };
  return { ok: true };
}

async function payOfficeExpense(id: string, actor: { id: string }, input: PayInput): Promise<PayResult> {
  if (!isUuid(id)) return { ok: false, error: 'Invalid id' };
  const [affectedCount] = await db.OfficeOperationExpense.update(
    {
      payment_status: 'paid',
      paid_at: input.paymentDate ? new Date(input.paymentDate) : new Date(),
      paid_by: actor.id,
      payment_method: input.paymentMethod || null,
      payment_reference: input.paymentReference || null,
      payment_proof_urls: input.proofUrls || []
    } as never,
    { where: { id, payment_status: 'payment_required' } as never }
  );
  if (!affectedCount) return { ok: false, error: 'This expense is not awaiting payment — it may already be paid' };
  return { ok: true };
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

// Best-effort — used only to address the Part 18 hold/resume notification
// to whoever originally requested the underlying record. Admin Expense has
// no single requester (it's a batch of beneficiary employees, not a
// requester — see getAdminExpenseItems above), so it's left unresolved and
// that notification is simply skipped for that source.
export async function resolveRequesterUsername(source: PaymentSource, sourceId: string): Promise<string | null> {
  switch (source) {
    case 'reimbursement_sheet': {
      const sheet = await reimbursementSheetStore.findById(sourceId);
      return sheet?.created_by || null;
    }
    case 'office_expense': {
      const expense = await officeOperationExpenseStore.findById(sourceId);
      return expense?.created_by || null;
    }
    case 'bom_request': {
      const rows = await tmsBomRequestStore.list();
      const existing = rows.find((r) => r.id === sourceId);
      if (!existing?.requested_by_id) return null;
      const user = await db.User.findByPk(existing.requested_by_id, { attributes: ['username'] });
      return user ? ((user.get({ plain: true }) as Record<string, unknown>).username as string) : null;
    }
    case 'travel_schedule': {
      const existing = await travelScheduleStore.findById(sourceId);
      return existing?.created_by || null;
    }
    default:
      return null;
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
