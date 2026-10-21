import { Model, Op } from 'sequelize';
import { DcLineItem, DeliveryChallanRecord } from './types';
import { db, isUuid, sequelize } from './db';
import { getAppConfig } from './appConfigStore';
import { resolveVisibilityScope } from './departmentScope';

const FIELDS = [
  { name: 'dc_number' },
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'custom_project_name', kind: 'nullable' as const },
  { name: 'demo_id', kind: 'nullable' as const },
  { name: 'client_name' },
  { name: 'client_address', kind: 'nullable' as const },
  { name: 'client_phone', kind: 'nullable' as const },
  { name: 'issued_by' },
  { name: 'issued_by_phone', kind: 'nullable' as const },
  { name: 'issued_date', kind: 'nullable' as const },
  { name: 'expected_return_date', kind: 'nullable' as const },
  { name: 'assigned_engineer' },
  { name: 'status' },
  { name: 'material_return', kind: 'json' as const },
  { name: 'demo_cost_amount', kind: 'decimal' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable') return value === '' || value === undefined ? null : value;
  // A DECIMAL column rejects an empty string, and NULL is the meaningful
  // "not recorded" value here — so blank must become null, never 0.
  if (kind === 'decimal') {
    return value === '' || value === undefined || value === null ? null : value;
  }
  return value;
}

function itemToRow(item: DcLineItem, deliveryChallanId: string) {
  return {
    delivery_challan_id: deliveryChallanId,
    product: item.product,
    hsn_code: item.hsnCode || '',
    serial_number: item.serialNumber,
    quantity: item.quantity,
    price: item.price || 0
  };
}

// Takes an already-plain object, not a Model — these come from a parent
// row's `.get({ plain: true })`, which recursively flattens included
// associations into plain objects too (never Model instances here).
function rowToItem(plain: Record<string, unknown>): DcLineItem {
  return {
    product: (plain.product as string) ?? '',
    hsnCode: (plain.hsn_code as string) ?? '',
    serialNumber: (plain.serial_number as string) ?? '',
    quantity: (plain.quantity as number) ?? 0,
    price: Number(plain.price) || 0
  };
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const itemsInclude = { model: db.DeliveryChallanItem, as: 'items' };
// The `attributes` list is mandatory, not tidiness: the Project model
// declares around sixty columns, and omitting it would pull every one of
// them into each DC row to render a single label.
const projectInclude = {
  model: db.Project,
  as: 'project',
  attributes: ['id', 'project_name', 'company', 'client_name']
};
const allIncludes = [creatorInclude, itemsInclude, projectInclude];

/**
 * What to call the linked project, for display only.
 *
 * project_name first, and the order matters: a DC copies client_name FROM
 * the project when it is created, so leading with the project's client_name
 * would make the Project column print the same string as the Client column
 * sitting next to it. company is the better second choice for that reason.
 *
 * Worth knowing: projects.project_name is an optional intake field with no
 * required check and no backfill, so in practice this column reads "the deal
 * name where somebody typed one, the company where nobody did". That is a
 * real improvement on a UUID, but it is not a clean dataset.
 */
function projectLabelOf(project: unknown): string {
  const p = project as { project_name?: string; company?: string; client_name?: string } | null | undefined;
  if (!p) return '';
  return p.project_name || p.company || p.client_name || '';
}

function toRecord(row: Model): DeliveryChallanRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    items: ((plain.items as Record<string, unknown>[]) ?? []).map(rowToItem),
    project_name: projectLabelOf(plain.project)
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'json') record[name] = raw ?? {};
    // node-postgres hands back DECIMAL as a STRING to preserve precision, so
    // without this the amount reaches the UI as "1500.00" — where
    // toLocaleString('en-IN') is a no-op and every numeric total sums it as
    // 0. Empty string, not 0, when the column is NULL: the dash the table
    // shows for "nothing recorded" depends on telling those apart.
    else if (kind === 'decimal') record[name] = raw === null || raw === undefined ? '' : Number(raw);
    else record[name] = raw ?? '';
  }
  return record as unknown as DeliveryChallanRecord;
}

async function readAll(): Promise<DeliveryChallanRecord[]> {
  const rows = await db.DeliveryChallan.findAll({ include: allIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

// viewerIsPrivileged is kept for call-site compatibility but no longer used
// directly — visibility is resolved from the viewer's department scope
// instead (see resolveVisibilityScope). includeBackofficeTeam is a genuinely
// separate, additive widening (any backoffice-role user shares the whole
// dispatch/return queue, independent of department) — the route passes it
// when viewer.role === 'backoffice', preserving that existing behavior on
// top of, not instead of, department scoping.
async function list(viewerUsername: string, _viewerIsPrivileged?: boolean, includeBackofficeTeam?: boolean): Promise<DeliveryChallanRecord[]> {
  const scope = await resolveVisibilityScope(viewerUsername);
  let allowedIds = scope.scopedUserIds;
  if (allowedIds && includeBackofficeTeam) {
    const backofficeUsers = await db.User.findAll({
      include: [{ model: db.Role, as: 'role', where: { key: 'backoffice' } as never, attributes: [] }],
      attributes: ['id']
    });
    allowedIds = Array.from(new Set([...allowedIds, ...backofficeUsers.map((u) => u.get('id') as string)]));
  }
  const where: Record<string, unknown> = allowedIds ? { created_by: { [Op.in]: allowedIds } } : {};
  const rows = await db.DeliveryChallan.findAll({ where: where as never, include: allIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

// Strictly "DCs this one user personally issued" — used by admin
// per-employee reports; see projectStore.listOwnedBy for why this can't
// reuse the (now department-scoped) list() above.
async function listOwnedBy(username: string): Promise<DeliveryChallanRecord[]> {
  const user = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
  const where = { created_by: user ? user.get('id') : '00000000-0000-0000-0000-000000000000' };
  const rows = await db.DeliveryChallan.findAll({ where: where as never, include: allIncludes, order: [['created_at', 'DESC']] });
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
    const withAssoc = await db.DeliveryChallan.findByPk(row.get('id') as string, { include: allIncludes, transaction: t });
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

    const withAssoc = await db.DeliveryChallan.findByPk(id, { include: allIncludes, transaction: t });
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

export const deliveryChallanStore = { list, listOwnedBy, create, update, remove };

export async function findDeliveryChallanById(id: string): Promise<DeliveryChallanRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.DeliveryChallan.findByPk(id, { include: allIncludes });
  return row ? toRecord(row) : undefined;
}

// <prefix><seq> — same "read everything, find the max sequence, +1" approach
// as lib/quotationNumber.ts. Prefix is admin-configurable (Application
// Configuration > Number Series); changing it only affects new DCs —
// existing dc_numbers keep whatever prefix they were created with.
export async function nextDcNumber(): Promise<string> {
  // paranoid: false — a soft-deleted DC's dc_number still occupies the
  // column's real unique constraint at the DB level (Sequelize's paranoid
  // exclusion is an app-level query filter, not a DB-level one), so the
  // default findAll (which excludes deleted rows) could recompute a number
  // that collides with one a deleted row still physically holds.
  const [rows, config] = await Promise.all([db.DeliveryChallan.findAll({ attributes: ['dc_number'], paranoid: false }), getAppConfig()]);
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
