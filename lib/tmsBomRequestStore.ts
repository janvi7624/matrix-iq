import { Model, Op } from 'sequelize';
import { TmsBomRequestRecord } from './types';
import { db, isUuid, sequelize } from './db';
import { nextTmsProcurementCode } from './tmsProcurementStore';
import { TmsViewer, isTmsAdminTier, canManageAllTmsBomRequests, tmsTeamDepartmentIds } from './tmsAccess';

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
  { name: 'admin_reviewed_by_id', kind: 'nullable' as const },
  { name: 'admin_reviewed_at', kind: 'date' as const },
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
const adminReviewedByInclude = { model: db.User, as: 'adminReviewedBy', attributes: ['id', 'name'] };
const financeReviewedByInclude = { model: db.User, as: 'financeReviewedBy', attributes: ['id', 'name'] };
const paymentMarkedByInclude = { model: db.User, as: 'paymentMarkedBy', attributes: ['id', 'name'] };
const receivedByInclude = { model: db.User, as: 'receivedBy', attributes: ['id', 'name'] };
const deptInclude = { model: db.Department, as: 'department', attributes: ['id', 'name'] };
const projectInclude = { model: db.TmsProject, as: 'project', attributes: ['id', 'name'] };
const ALL_INCLUDES = [
  creatorInclude,
  requestedByInclude,
  reviewedByInclude,
  adminReviewedByInclude,
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
    admin_reviewed_by_name: (plain.adminReviewedBy as { name?: string } | null)?.name ?? '',
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

// Unscoped read of every BOM request — for Accounts' cross-department payment
// queue (lib/accountsPaymentStore.ts) and Department Health scoring
// (lib/departmentScoring.ts), and for a project-detail page that has already
// authorized the viewer for that one project (app/api/tms/projects/[id])  and
// just filters this down to it. Same "unscoped reader kept separate from the
// viewer-scoped one" split as lib/tmsProjectStore.ts's readAll()/list().
async function readAll(): Promise<TmsBomRequestRecord[]> {
  const rows = await db.TmsBomRequest.findAll({ include: ALL_INCLUDES, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

// Row-level visibility: admin/superadmin see everything; technical-manager/
// team-lead (or anyone else granted manage:true on tms-bom-requests) see
// every request touching their own department's team — department_id is a
// real FK here, same as tms_tasks, so this scopes on it directly rather than
// joining back through the project (see lib/tmsTaskStore.ts's list() for the
// identical shape). Everyone else sees only what they requested or created.
// This used to be an unscoped flat pool shared across every technical
// department regardless of viewer — that was a real bug (any engineer in any
// department could see every other department's BOM requests), not a
// deliberate "they all share one pool" design.
async function list(viewer: TmsViewer): Promise<TmsBomRequestRecord[]> {
  if (isTmsAdminTier(viewer)) return readAll();

  const ownId = viewer.userId || '00000000-0000-0000-0000-000000000000';
  const scopes: Record<string, unknown>[] = [{ requested_by_id: ownId }, { created_by: ownId }];
  if (await canManageAllTmsBomRequests(viewer)) {
    const teamDepartmentIds = await tmsTeamDepartmentIds(viewer);
    if (teamDepartmentIds.length) scopes.push({ department_id: teamDepartmentIds });
  }

  const rows = await db.TmsBomRequest.findAll({
    where: { [Op.or]: scopes } as never,
    include: ALL_INCLUDES,
    order: [['created_at', 'DESC']]
  });
  return rows.map(toRecord);
}

async function findById(id: string): Promise<TmsBomRequestRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return row ? toRecord(row) : undefined;
}

// createdById: the caller's already-verified user id (from getTmsViewer),
// preferred over re-deriving it from record.created_by's username here. That
// second, independent username lookup was the actual cause of OPSQA-DEF-001
// (BOM requests silently recorded with created_by/requested_by_id both NULL
// right after login) — a transient miss on this lookup used to fall back to
// `null` instead of failing loudly. Falling back to the username lookup only
// covers callers that genuinely have no id in hand yet; it still throws
// rather than silently writing an unattributed row if that also can't
// resolve, since a BOM request with no recorded requester is an audit gap,
// not a recoverable condition.
async function create(record: TmsBomRequestRecord, createdById?: string): Promise<TmsBomRequestRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);

  let resolvedCreatorId = createdById || '';
  if (!resolvedCreatorId) {
    const creator = await db.User.findOne({ where: { username: record.created_by } as never });
    resolvedCreatorId = creator ? (creator.get('id') as string) : '';
  }
  if (!resolvedCreatorId) {
    throw new Error('Could not establish the authenticated requester\'s identity — refusing to create an unattributed BOM request.');
  }

  const row = await db.TmsBomRequest.create({ ...attrs, created_by: resolvedCreatorId } as never);
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
  // Conditional on the status read above still holding at write time — the
  // caller already checked status is submitted/under_review against this
  // same read, but without this WHERE two concurrent decisions (a double-
  // click, or an approve racing a reject) would both pass and both write,
  // with the loser's notification/email still firing for a decision that
  // never actually stuck.
  const [affected] = await db.TmsBomRequest.update(
    {
      status: decision,
      reviewed_by_id: reviewer ? reviewer.get('id') : null,
      reviewed_at: new Date(),
      rejection_reason: decision === 'rejected' ? rejectionReason || '' : ''
    } as never,
    { where: { id, status: row.get('status') } as never }
  );
  if (!affected) return null;
  const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// approved -> admin_approved | rejected. Mirrors decide() but stamps the
// admin_reviewed_* columns instead of reviewed_* — kept separate so the
// Technical Manager's original decision (reviewed_by/at) is never
// overwritten by the later Administration stage.
async function adminDecide(id: string, decision: 'admin_approved' | 'rejected', reviewerUsername: string, rejectionReason?: string): Promise<TmsBomRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;
  const reviewer = await db.User.findOne({ where: { username: reviewerUsername } as never });
  const [affected] = await db.TmsBomRequest.update(
    {
      status: decision,
      admin_reviewed_by_id: reviewer ? reviewer.get('id') : null,
      admin_reviewed_at: new Date(),
      rejection_reason: decision === 'rejected' ? rejectionReason || '' : ''
    } as never,
    { where: { id, status: row.get('status') } as never }
  );
  if (!affected) return null;
  const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// admin_approved -> finance_approved | rejected. Mirrors decide() but stamps the
// finance_reviewed_* columns instead of reviewed_* — kept separate so the
// Technical Manager's original decision (reviewed_by/at) is never
// overwritten by the later Finance stage.
async function financeDecide(id: string, decision: 'finance_approved' | 'rejected', reviewerUsername: string, rejectionReason?: string): Promise<TmsBomRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;
  const reviewer = await db.User.findOne({ where: { username: reviewerUsername } as never });
  const [affected] = await db.TmsBomRequest.update(
    {
      status: decision,
      finance_reviewed_by_id: reviewer ? reviewer.get('id') : null,
      finance_reviewed_at: new Date(),
      rejection_reason: decision === 'rejected' ? rejectionReason || '' : ''
    } as never,
    { where: { id, status: row.get('status') } as never }
  );
  if (!affected) return null;
  const withAssoc = await db.TmsBomRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// finance_approved -> payment_done. proofUrls are appended onto
// payment_proof_attachments (kept separate from the general `attachments`
// array so "Accounts' payment proof" doesn't get mixed in with the
// engineer's spec sheets/quotes).
async function markPaymentDone(id: string, actorUsername: string, proofUrls: string[], paidAt?: Date): Promise<TmsBomRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsBomRequest.findByPk(id);
  if (!row) return null;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const actor = await db.User.findOne({ where: { username: actorUsername } as never });
  const existingProof = Array.isArray(plain.payment_proof_attachments) ? (plain.payment_proof_attachments as string[]) : [];
  // Conditional on the status read above still holding at write time — the
  // caller (accounts-payment pay route) already checked isBomAwaitingPayment
  // against this same read, but without this WHERE two concurrent "Pay"
  // submissions would both pass that check and both write, doubling up the
  // proof-attachments array and sending a duplicate payment-done notice.
  const [affected] = await db.TmsBomRequest.update(
    {
      status: 'payment_done',
      payment_marked_by_id: actor ? actor.get('id') : null,
      payment_marked_at: paidAt ?? new Date(),
      payment_proof_attachments: [...existingProof, ...proofUrls]
    } as never,
    { where: { id, status: plain.status } as never }
  );
  if (!affected) return null;
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
  const [affected] = await db.TmsBomRequest.update(
    { status: 'received', received_by_id: actor ? actor.get('id') : null, received_at: new Date() } as never,
    { where: { id, status: row.get('status') } as never }
  );
  if (!affected) return null;
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
    // Conditional on the status read above still holding, inside the same
    // transaction — without this, two concurrent "Send to procurement"
    // submissions (double-click) would both pass the route's status check
    // and both create a TmsProcurement row for the same BOM request,
    // duplicating the downstream procurement record, not just a notice.
    const [affected] = await db.TmsBomRequest.update(
      { status: 'sent_for_procurement' } as never,
      { where: { id, status: plain.status } as never, transaction: t }
    );
    if (!affected) return null;
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

export const tmsBomRequestStore = { list, readAll, findById, create, update, submit, decide, adminDecide, financeDecide, markPaymentDone, markReceived, sendToProcurement, remove };

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
