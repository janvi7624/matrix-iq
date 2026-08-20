import { Model } from 'sequelize';
import { TmsBomRequestRecord } from './types';
import { db, isUuid, sequelize } from './db';
import { nextTmsProcurementCode } from './tmsProcurementStore';

const FIELDS = [
  { name: 'bom_request_code' },
  { name: 'project_id' },
  { name: 'requested_by_id', kind: 'nullable' as const },
  { name: 'department_id', kind: 'nullable' as const },
  { name: 'request_date', kind: 'nullable' as const },
  { name: 'required_date', kind: 'nullable' as const },
  { name: 'item_name' },
  { name: 'item_description' },
  { name: 'part_number' },
  { name: 'quantity', kind: 'number' as const },
  { name: 'specification' },
  { name: 'preferred_brand' },
  { name: 'estimated_cost', kind: 'number' as const },
  { name: 'remarks' },
  { name: 'attachments', kind: 'json' as const },
  { name: 'status' },
  { name: 'rejection_reason' },
  { name: 'reviewed_by_id', kind: 'nullable' as const },
  { name: 'reviewed_at', kind: 'date' as const },
  { name: 'finance_reviewed_by_id', kind: 'nullable' as const },
  { name: 'finance_reviewed_at', kind: 'date' as const },
  { name: 'payment_marked_by_id', kind: 'nullable' as const },
  { name: 'payment_marked_at', kind: 'date' as const },
  { name: 'payment_proof_attachments', kind: 'json' as const },
  { name: 'received_by_id', kind: 'nullable' as const },
  { name: 'received_at', kind: 'date' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable' || kind === 'date') return value === '' || value === undefined ? null : value;
  if (kind === 'number') return value === '' || value === undefined || value === null ? null : value;
  return value;
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const requestedByInclude = { model: db.User, as: 'requestedBy', attributes: ['id', 'name'] };
const reviewedByInclude = { model: db.User, as: 'reviewedBy', attributes: ['id', 'name'] };
const financeReviewedByInclude = { model: db.User, as: 'financeReviewedBy', attributes: ['id', 'name'] };
const paymentMarkedByInclude = { model: db.User, as: 'paymentMarkedBy', attributes: ['id', 'name'] };
const receivedByInclude = { model: db.User, as: 'receivedBy', attributes: ['id', 'name'] };
const deptInclude = { model: db.Department, as: 'department', attributes: ['id', 'name'] };
const projectInclude = { model: db.TmsProject, as: 'project', attributes: ['id', 'name'] };
const ALL_INCLUDES = [
  creatorInclude,
  requestedByInclude,
  reviewedByInclude,
  financeReviewedByInclude,
  paymentMarkedByInclude,
  receivedByInclude,
  deptInclude,
  projectInclude
];

function toRecord(row: Model): TmsBomRequestRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    project_name: (plain.project as { name?: string } | null)?.name ?? '',
    requested_by_name: (plain.requestedBy as { name?: string } | null)?.name ?? '',
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
    reviewed_by_name: (plain.reviewedBy as { name?: string } | null)?.name ?? '',
    finance_reviewed_by_name: (plain.financeReviewedBy as { name?: string } | null)?.name ?? '',
    payment_marked_by_name: (plain.paymentMarkedBy as { name?: string } | null)?.name ?? '',
    received_by_name: (plain.receivedBy as { name?: string } | null)?.name ?? '',
    updated_at: isoOrEmpty(plain.updatedAt)
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'date') record[name] = isoOrEmpty(raw);
    else if (kind === 'number') record[name] = raw === null || raw === undefined ? 0 : Number(raw);
    else if (kind === 'json') record[name] = raw ?? [];
    else record[name] = raw ?? '';
  }
  return record as unknown as TmsBomRequestRecord;
}

// Row-level visibility: no filter beyond the module/action gate already
// checked at the route level — every viewer who can view tms-bom-requests
// sees the full flat pool (same "any of the 4 technical departments
// collaborates on the same pool" rule as Projects/Procurement).
async function list(): Promise<TmsBomRequestRecord[]> {
  const rows = await db.TmsBomRequest.findAll({ include: ALL_INCLUDES, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function findById(id: string): Promise<TmsBomRequestRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return row ? toRecord(row) : undefined;
}

async function create(record: TmsBomRequestRecord): Promise<TmsBomRequestRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  const row = await db.TmsBomRequest.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never);
  const withAssoc = await db.TmsBomRequest.findByPk(row.get('id') as string, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// Free-form field patch — only allowed while still 'draft' (enforced by the
// route, not here, mirroring how existing stores keep capability checks in
// the route and shape/persistence here).
async function update(id: string, patch: Partial<TmsBomRequestRecord>): Promise<TmsBomRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;

  const attrs: Record<string, unknown> = {};
  const patchObj = patch as unknown as Record<string, unknown>;
  for (const { name, kind = 'string' } of FIELDS) {
    if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
  }
  await row.update(attrs as never);
  const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// draft -> submitted.
async function submit(id: string): Promise<TmsBomRequestRecord | null> {
  return update(id, { status: 'submitted' });
}

// submitted/under_review -> approved | rejected. `reviewerUsername` resolves
// to reviewed_by_id; reviewed_at is stamped here, not left to the caller.
async function decide(id: string, decision: 'approved' | 'rejected', reviewerUsername: string, rejectionReason?: string): Promise<TmsBomRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;
  const reviewer = await db.User.findOne({ where: { username: reviewerUsername } as never });
  await row.update(
    {
      status: decision,
      reviewed_by_id: reviewer ? reviewer.get('id') : null,
      reviewed_at: new Date(),
      rejection_reason: decision === 'rejected' ? rejectionReason || '' : ''
    } as never
  );
  const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// approved -> finance_approved | rejected. Mirrors decide() but stamps the
// finance_reviewed_* columns instead of reviewed_* — kept separate so the
// Technical Manager's original decision (reviewed_by/at) is never
// overwritten by the later Finance stage.
async function financeDecide(id: string, decision: 'finance_approved' | 'rejected', reviewerUsername: string, rejectionReason?: string): Promise<TmsBomRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;
  const reviewer = await db.User.findOne({ where: { username: reviewerUsername } as never });
  await row.update(
    {
      status: decision,
      finance_reviewed_by_id: reviewer ? reviewer.get('id') : null,
      finance_reviewed_at: new Date(),
      rejection_reason: decision === 'rejected' ? rejectionReason || '' : ''
    } as never
  );
  const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// finance_approved -> payment_done. proofUrls are appended onto
// payment_proof_attachments (kept separate from the general `attachments`
// array so "Accounts' payment proof" doesn't get mixed in with the
// engineer's spec sheets/quotes).
async function markPaymentDone(id: string, actorUsername: string, proofUrls: string[]): Promise<TmsBomRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const actor = await db.User.findOne({ where: { username: actorUsername } as never });
  const existingProof = Array.isArray(plain.payment_proof_attachments) ? (plain.payment_proof_attachments as string[]) : [];
  await row.update(
    {
      status: 'payment_done',
      payment_marked_by_id: actor ? actor.get('id') : null,
      payment_marked_at: new Date(),
      payment_proof_attachments: [...existingProof, ...proofUrls]
    } as never
  );
  const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// payment_done -> received — the original requester confirming the
// material is physically in hand, closing out the chain.
async function markReceived(id: string, actorUsername: string): Promise<TmsBomRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;
  const actor = await db.User.findOne({ where: { username: actorUsername } as never });
  await row.update({ status: 'received', received_by_id: actor ? actor.get('id') : null, received_at: new Date() } as never);
  const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// approved -> sent_for_procurement, and — inside the same transaction —
// creates a linked TmsProcurement row pre-filled from the BOM's item/part/
// qty/estimated cost, maintaining the Project -> BOM Request -> Procurement
// chain the spec requires.
async function sendToProcurement(id: string, actorUsername: string): Promise<{ bomRequest: TmsBomRequestRecord; procurementId: string } | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const creator = await db.User.findOne({ where: { username: actorUsername } as never });
  const procurementCode = await nextTmsProcurementCode();

  return sequelize.transaction(async (t) => {
    await row.update({ status: 'sent_for_procurement' } as never, { transaction: t });
    const procRow = await db.TmsProcurement.create(
      {
        procurement_code: procurementCode,
        project_id: plain.project_id,
        bom_request_id: id,
        item_name: plain.item_name,
        part_number: plain.part_number,
        quantity: plain.quantity,
        estimated_cost: plain.estimated_cost,
        request_date: plain.request_date,
        required_date: plain.required_date,
        purchase_status: 'requested',
        delivery_status: 'pending',
        created_by: creator ? creator.get('id') : null
      } as never,
      { transaction: t }
    );
    const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES, transaction: t });
    return { bomRequest: toRecord(withAssoc as Model), procurementId: procRow.get('id') as string };
  });
}

async function remove(id: string, viewerIsPrivilegedOrManages: boolean): Promise<boolean> {
  if (!viewerIsPrivilegedOrManages) return false;
  if (!isUuid(id)) return false;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export const tmsBomRequestStore = { list, findById, create, update, submit, decide, financeDecide, markPaymentDone, markReceived, sendToProcurement, remove };

// BOM-<seq> — same "read everything, find the max sequence, +1" approach as
// lib/deliveryChallanStore.ts's nextDcNumber().
export async function nextTmsBomRequestCode(): Promise<string> {
  const rows = await db.TmsBomRequest.findAll({ attributes: ['bom_request_code'], paranoid: false });
  const prefix = 'BOM-';
  const pattern = /^BOM-(\d+)$/;
  const max = rows.reduce((acc, r) => {
    const code = r.get('bom_request_code') as string;
    const match = code ? code.match(pattern) : null;
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
