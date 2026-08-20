import { Model } from 'sequelize';
import { TmsProcurementRecord } from './types';
import { db, isUuid } from './db';

const FIELDS = [
  { name: 'procurement_code' },
  { name: 'project_id' },
  { name: 'bom_request_id', kind: 'nullable' as const },
  { name: 'item_name' },
  { name: 'part_number' },
  { name: 'quantity', kind: 'number' as const },
  { name: 'vendor' },
  { name: 'estimated_cost', kind: 'number' as const },
  { name: 'quoted_cost', kind: 'number' as const },
  { name: 'final_cost', kind: 'number' as const },
  { name: 'request_date', kind: 'nullable' as const },
  { name: 'required_date', kind: 'nullable' as const },
  { name: 'expected_delivery_date', kind: 'nullable' as const },
  { name: 'actual_delivery_date', kind: 'nullable' as const },
  { name: 'purchase_status' },
  { name: 'delivery_status' },
  { name: 'remarks' },
  { name: 'documents', kind: 'json' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable') return value === '' || value === undefined ? null : value;
  if (kind === 'number') return value === '' || value === undefined || value === null ? null : value;
  return value;
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const projectInclude = { model: db.TmsProject, as: 'project', attributes: ['id', 'name'] };
const bomRequestInclude = { model: db.TmsBomRequest, as: 'bomRequest', attributes: ['id', 'bom_request_code'] };
const ALL_INCLUDES = [creatorInclude, projectInclude, bomRequestInclude];

function toRecord(row: Model): TmsProcurementRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    project_name: (plain.project as { name?: string } | null)?.name ?? '',
    bom_request_code: (plain.bomRequest as { bom_request_code?: string } | null)?.bom_request_code ?? '',
    updated_at: isoOrEmpty(plain.updatedAt)
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'number') record[name] = raw === null || raw === undefined ? 0 : Number(raw);
    else if (kind === 'json') record[name] = raw ?? [];
    else record[name] = raw ?? '';
  }
  return record as unknown as TmsProcurementRecord;
}

// Row-level visibility: no filter beyond the module/action gate already
// checked at the route level — same flat-pool rule as Projects/BOM Requests.
async function list(): Promise<TmsProcurementRecord[]> {
  const rows = await db.TmsProcurement.findAll({ include: ALL_INCLUDES, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function findById(id: string): Promise<TmsProcurementRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.TmsProcurement.findByPk(id, { include: ALL_INCLUDES });
  return row ? toRecord(row) : undefined;
}

async function create(record: TmsProcurementRecord): Promise<TmsProcurementRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  const row = await db.TmsProcurement.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never);
  const withAssoc = await db.TmsProcurement.findByPk(row.get('id') as string, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

// Validates purchase_status/delivery_status stay within their declared enums
// (the DB ENUM column already enforces this too — this is just a clean 400
// instead of a raw Postgres error) and auto-sets actual_delivery_date when
// delivery_status transitions to 'received'.
const PURCHASE_STATUSES = ['requested', 'quotation_required', 'quotation_received', 'approval_pending', 'approved', 'po_created', 'ordered', 'cancelled'];
const DELIVERY_STATUSES = ['pending', 'partially_received', 'received', 'cancelled'];

async function update(id: string, patch: Partial<TmsProcurementRecord>): Promise<TmsProcurementRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsProcurement.findByPk(id);
  if (!row) return null;

  if (patch.purchase_status !== undefined && !PURCHASE_STATUSES.includes(patch.purchase_status)) {
    throw new Error('Invalid purchase status');
  }
  if (patch.delivery_status !== undefined && !DELIVERY_STATUSES.includes(patch.delivery_status)) {
    throw new Error('Invalid delivery status');
  }

  const attrs: Record<string, unknown> = {};
  const patchObj = patch as unknown as Record<string, unknown>;
  for (const { name, kind = 'string' } of FIELDS) {
    if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
  }

  if (patch.delivery_status === 'received' && !('actual_delivery_date' in patchObj)) {
    const current = row.get({ plain: true }) as Record<string, unknown>;
    if (current.delivery_status !== 'received') attrs.actual_delivery_date = new Date().toISOString().slice(0, 10);
  }

  await row.update(attrs as never);
  const withAssoc = await db.TmsProcurement.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

async function remove(id: string, viewerIsPrivilegedOrManages: boolean): Promise<boolean> {
  if (!viewerIsPrivilegedOrManages) return false;
  if (!isUuid(id)) return false;
  const row = await db.TmsProcurement.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export const tmsProcurementStore = { list, findById, create, update, remove };

// PROC-<seq> — same "read everything, find the max sequence, +1" approach as
// lib/deliveryChallanStore.ts's nextDcNumber().
export async function nextTmsProcurementCode(): Promise<string> {
  const rows = await db.TmsProcurement.findAll({ attributes: ['procurement_code'], paranoid: false });
  const prefix = 'PROC-';
  const pattern = /^PROC-(\d+)$/;
  const max = rows.reduce((acc, r) => {
    const code = r.get('procurement_code') as string;
    const match = code ? code.match(pattern) : null;
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
