import { Model } from 'sequelize';
import { DemoProductLine, DemoScheduleRecord } from './types';
import { db, isUuid, sequelize } from './db';

const FIELDS = [
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'quotation_id', kind: 'nullable' as const },
  { name: 'client_name' },
  { name: 'company' },
  { name: 'location' },
  { name: 'product_domains', kind: 'json' as const },
  { name: 'products_demonstrated', kind: 'json' as const },
  { name: 'priority' },
  { name: 'assigned_technical_person' },
  { name: 'technical_members', kind: 'json' as const },
  { name: 'scheduled_at', kind: 'nullable' as const },
  { name: 'assigned_rep' },
  { name: 'status' },
  { name: 'technical_approval', kind: 'json' as const },
  { name: 'manager_approval', kind: 'json' as const },
  { name: 'notes' },
  { name: 'demo_objective' },
  { name: 'outcome', kind: 'nullable' as const },
  { name: 'customer_rating', kind: 'number' as const },
  { name: 'key_queries' },
  { name: 'technical_challenges' },
  { name: 'unanswered_queries' },
  { name: 'suggested_next_action' },
  { name: 'next_follow_up_date', kind: 'nullable' as const },
  { name: 'attachments', kind: 'json' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable') return value === '' || value === undefined ? null : value;
  return value;
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const productLinesInclude = { model: db.DemoProductLine, as: 'productLines' };

function toRecord(row: Model): DemoScheduleRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    // plain.productLines entries are already plain objects (a parent row's
    // `.get({ plain: true })` recursively flattens included associations),
    // not Model instances.
    products_required: ((plain.productLines as Record<string, unknown>[]) ?? []).map(
      (p) => ({ product: p.product as string, quantity: p.quantity as number } as DemoProductLine)
    )
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'number') record[name] = raw === null || raw === undefined ? 0 : Number(raw);
    else if (kind === 'json') record[name] = raw ?? (name.endsWith('approval') ? {} : []);
    else record[name] = raw ?? '';
  }
  return record as unknown as DemoScheduleRecord;
}

async function readAll(): Promise<DemoScheduleRecord[]> {
  const rows = await db.DemoSchedule.findAll({ include: [creatorInclude, productLinesInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<DemoScheduleRecord[]> {
  const where: Record<string, unknown> = {};
  if (!viewerIsPrivileged) {
    const user = await db.User.findOne({ where: { username: viewerUsername } as never });
    where.created_by = user ? user.get('id') : '00000000-0000-0000-0000-000000000000';
  }
  const rows = await db.DemoSchedule.findAll({ where: where as never, include: [creatorInclude, productLinesInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function create(record: DemoScheduleRecord): Promise<DemoScheduleRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  return sequelize.transaction(async (t) => {
    const row = await db.DemoSchedule.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never, { transaction: t });
    if (record.products_required?.length) {
      await db.DemoProductLine.bulkCreate(
        record.products_required.map((p) => ({ demo_schedule_id: row.get('id'), product: p.product, quantity: p.quantity })) as never,
        { transaction: t }
      );
    }
    const withAssoc = await db.DemoSchedule.findByPk(row.get('id') as string, { include: [creatorInclude, productLinesInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function update(id: string, patch: Partial<DemoScheduleRecord>): Promise<DemoScheduleRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.DemoSchedule.findByPk(id);
  if (!row) return null;

  return sequelize.transaction(async (t) => {
    const attrs: Record<string, unknown> = {};
    const patchObj = patch as unknown as Record<string, unknown>;
    for (const { name, kind = 'string' } of FIELDS) {
      if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
    }
    await row.update(attrs as never, { transaction: t });

    if (patch.products_required) {
      await db.DemoProductLine.destroy({ where: { demo_schedule_id: id } as never, transaction: t });
      if (patch.products_required.length) {
        await db.DemoProductLine.bulkCreate(
          patch.products_required.map((p) => ({ demo_schedule_id: id, product: p.product, quantity: p.quantity })) as never,
          { transaction: t }
        );
      }
    }

    const withAssoc = await db.DemoSchedule.findByPk(id, { include: [creatorInclude, productLinesInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<boolean> {
  if (!viewerIsPrivileged) return false;
  if (!isUuid(id)) return false;
  const row = await db.DemoSchedule.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export const demoScheduleStore = { list, create, update, remove, readAll };
