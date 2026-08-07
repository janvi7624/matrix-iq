import { Model } from 'sequelize';
import { DcLineItem, DeliveryChallanRecord } from './types';
import { db, isUuid, sequelize } from './db';
import { getAppConfig } from './appConfigStore';

const FIELDS = [
  { name: 'dc_number' },
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'demo_id', kind: 'nullable' as const },
  { name: 'client_name' },
  { name: 'issued_by' },
  { name: 'issued_date', kind: 'nullable' as const },
  { name: 'expected_return_date', kind: 'nullable' as const },
  { name: 'assigned_engineer' },
  { name: 'status' },
  { name: 'material_return', kind: 'json' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable') return value === '' || value === undefined ? null : value;
  return value;
}

function itemToRow(item: DcLineItem, deliveryChallanId: string) {
  return { delivery_challan_id: deliveryChallanId, product: item.product, serial_number: item.serialNumber, quantity: item.quantity };
}

// Takes an already-plain object, not a Model — these come from a parent
// row's `.get({ plain: true })`, which recursively flattens included
// associations into plain objects too (never Model instances here).
function rowToItem(plain: Record<string, unknown>): DcLineItem {
  return { product: (plain.product as string) ?? '', serialNumber: (plain.serial_number as string) ?? '', quantity: (plain.quantity as number) ?? 0 };
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const itemsInclude = { model: db.DeliveryChallanItem, as: 'items' };

function toRecord(row: Model): DeliveryChallanRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    items: ((plain.items as Record<string, unknown>[]) ?? []).map(rowToItem)
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'json') record[name] = raw ?? {};
    else record[name] = raw ?? '';
  }
  return record as unknown as DeliveryChallanRecord;
}

async function readAll(): Promise<DeliveryChallanRecord[]> {
  const rows = await db.DeliveryChallan.findAll({ include: [creatorInclude, itemsInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<DeliveryChallanRecord[]> {
  const where: Record<string, unknown> = {};
  if (!viewerIsPrivileged) {
    const user = await db.User.findOne({ where: { username: viewerUsername } as never });
    where.created_by = user ? user.get('id') : '00000000-0000-0000-0000-000000000000';
  }
  const rows = await db.DeliveryChallan.findAll({ where: where as never, include: [creatorInclude, itemsInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function create(record: DeliveryChallanRecord): Promise<DeliveryChallanRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  return sequelize.transaction(async (t) => {
    const row = await db.DeliveryChallan.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never, { transaction: t });
    if (record.items?.length) {
      await db.DeliveryChallanItem.bulkCreate(record.items.map((i) => itemToRow(i, row.get('id') as string)) as never, { transaction: t });
    }
    const withAssoc = await db.DeliveryChallan.findByPk(row.get('id') as string, { include: [creatorInclude, itemsInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function update(id: string, patch: Partial<DeliveryChallanRecord>): Promise<DeliveryChallanRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.DeliveryChallan.findByPk(id);
  if (!row) return null;

  return sequelize.transaction(async (t) => {
    const attrs: Record<string, unknown> = {};
    const patchObj = patch as unknown as Record<string, unknown>;
    for (const { name, kind = 'string' } of FIELDS) {
      if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
    }
    await row.update(attrs as never, { transaction: t });

    if (patch.items) {
      await db.DeliveryChallanItem.destroy({ where: { delivery_challan_id: id } as never, transaction: t });
      if (patch.items.length) {
        await db.DeliveryChallanItem.bulkCreate(patch.items.map((i) => itemToRow(i, id)) as never, { transaction: t });
      }
    }

    const withAssoc = await db.DeliveryChallan.findByPk(id, { include: [creatorInclude, itemsInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<boolean> {
  if (!viewerIsPrivileged) return false;
  if (!isUuid(id)) return false;
  const row = await db.DeliveryChallan.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export const deliveryChallanStore = { list, create, update, remove };

export async function findDeliveryChallanById(id: string): Promise<DeliveryChallanRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.DeliveryChallan.findByPk(id, { include: [creatorInclude, itemsInclude] });
  return row ? toRecord(row) : undefined;
}

// <prefix><seq> — same "read everything, find the max sequence, +1" approach
// as lib/quotationNumber.ts. Prefix is admin-configurable (Application
// Configuration > Number Series); changing it only affects new DCs —
// existing dc_numbers keep whatever prefix they were created with.
export async function nextDcNumber(): Promise<string> {
  const [rows, config] = await Promise.all([db.DeliveryChallan.findAll({ attributes: ['dc_number'] }), getAppConfig()]);
  const prefix = config.dcNumberPrefix || 'NT-DC-';
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedPrefix}(\\d+)$`);
  const max = rows.reduce((acc, r) => {
    const num = r.get('dc_number') as string;
    const match = num ? num.match(pattern) : null;
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export { readAll as readDeliveryChallans };
