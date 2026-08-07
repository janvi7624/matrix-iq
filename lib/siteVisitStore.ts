import { Model } from 'sequelize';
import { SiteVisitRecord, SiteVisitUpdateEntry } from './types';
import { db, isUuid, sequelize } from './db';

const FIELDS = [
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'company_name' },
  { name: 'contact_person' },
  { name: 'client_email' },
  { name: 'client_phone' },
  { name: 'location' },
  { name: 'visit_date', kind: 'nullable' as const },
  { name: 'team_technical', kind: 'json' as const },
  { name: 'team_sales', kind: 'json' as const },
  { name: 'purpose' },
  { name: 'category' },
  { name: 'products_interested', kind: 'json' as const },
  { name: 'visit_details' },
  { name: 'image_urls', kind: 'json' as const },
  { name: 'action_plan' },
  { name: 'reminder_date', kind: 'nullable' as const },
  { name: 'stage', kind: 'nullable' as const },
  { name: 'status' }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable') return value === '' || value === undefined ? null : value;
  return value;
}

function updateEntryToRow(entry: SiteVisitUpdateEntry, siteVisitId: string) {
  return {
    site_visit_id: siteVisitId,
    updated_at: entry.updated_at ? new Date(entry.updated_at) : new Date(),
    updated_by: entry.updated_by,
    team_technical: entry.team_technical,
    team_sales: entry.team_sales,
    project_details: entry.project_details,
    ongoing_activities: entry.ongoing_activities
  };
}

// Takes an already-plain object, not a Model — these come from a parent
// row's `.get({ plain: true })`, which recursively flattens included
// associations into plain objects too (never Model instances here).
function rowToUpdateEntry(plain: Record<string, unknown>): SiteVisitUpdateEntry {
  return {
    id: plain.id as string,
    updated_at: isoOrEmpty(plain.updated_at),
    updated_by: (plain.updated_by as string) ?? '',
    team_technical: (plain.team_technical as string[]) ?? [],
    team_sales: (plain.team_sales as string[]) ?? [],
    project_details: (plain.project_details as string) ?? '',
    ongoing_activities: (plain.ongoing_activities as string) ?? ''
  };
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const updatesInclude = { model: db.SiteVisitUpdate, as: 'updates' };

function toRecord(row: Model): SiteVisitRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    updates: ((plain.updates as Record<string, unknown>[]) ?? []).map(rowToUpdateEntry)
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'json') record[name] = raw ?? [];
    else record[name] = raw ?? '';
  }
  return record as unknown as SiteVisitRecord;
}

async function readAll(): Promise<SiteVisitRecord[]> {
  const rows = await db.SiteVisit.findAll({ include: [creatorInclude, updatesInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<SiteVisitRecord[]> {
  const where: Record<string, unknown> = {};
  if (!viewerIsPrivileged) {
    const user = await db.User.findOne({ where: { username: viewerUsername } as never });
    where.created_by = user ? user.get('id') : '00000000-0000-0000-0000-000000000000';
  }
  const rows = await db.SiteVisit.findAll({ where: where as never, include: [creatorInclude, updatesInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function create(record: SiteVisitRecord): Promise<SiteVisitRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  return sequelize.transaction(async (t) => {
    const row = await db.SiteVisit.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never, { transaction: t });
    if (record.updates?.length) {
      await db.SiteVisitUpdate.bulkCreate(record.updates.map((u) => updateEntryToRow(u, row.get('id') as string)) as never, { transaction: t });
    }
    const withAssoc = await db.SiteVisit.findByPk(row.get('id') as string, { include: [creatorInclude, updatesInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function update(id: string, patch: Partial<SiteVisitRecord>): Promise<SiteVisitRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.SiteVisit.findByPk(id);
  if (!row) return null;

  return sequelize.transaction(async (t) => {
    const attrs: Record<string, unknown> = {};
    const patchObj = patch as unknown as Record<string, unknown>;
    for (const { name, kind = 'string' } of FIELDS) {
      if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
    }
    if ('updated_at' in patchObj) attrs.updated_at = patchObj.updated_at ? new Date(patchObj.updated_at as string) : new Date();
    await row.update(attrs as never, { transaction: t });

    if (patch.updates) {
      await db.SiteVisitUpdate.destroy({ where: { site_visit_id: id } as never, transaction: t });
      if (patch.updates.length) {
        await db.SiteVisitUpdate.bulkCreate(patch.updates.map((u) => updateEntryToRow(u, id)) as never, { transaction: t });
      }
    }

    const withAssoc = await db.SiteVisit.findByPk(id, { include: [creatorInclude, updatesInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<boolean> {
  if (!viewerIsPrivileged) return false;
  if (!isUuid(id)) return false;
  const row = await db.SiteVisit.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export const siteVisitStore = { list, create, update, remove, readAll };
