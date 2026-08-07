import { Model } from 'sequelize';
import { MarketingRequestComment, MarketingRequestRecord } from './types';
import { db, isUuid, sequelize } from './db';

const FIELDS = [
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'title' },
  { name: 'request_type', kind: 'nullable' as const },
  { name: 'description' },
  { name: 'priority' },
  { name: 'needed_by_date', kind: 'nullable' as const },
  { name: 'attachments', kind: 'json' as const },
  { name: 'status' },
  { name: 'timeline', kind: 'json' as const },
  { name: 'rejection_reason' },
  { name: 'completion_notes' },
  { name: 'delivered_files', kind: 'json' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable') return value === '' || value === undefined ? null : value;
  return value;
}

function commentToRow(comment: MarketingRequestComment, marketingRequestId: string) {
  return {
    marketing_request_id: marketingRequestId,
    at: comment.at ? new Date(comment.at) : new Date(),
    by: comment.by,
    text: comment.text
  };
}

// Takes an already-plain object, not a Model — these come from a parent
// row's `.get({ plain: true })`, which recursively flattens included
// associations into plain objects too (never Model instances here).
function rowToComment(plain: Record<string, unknown>): MarketingRequestComment {
  return {
    id: plain.id as string,
    at: isoOrEmpty(plain.at),
    by: (plain.by as string) ?? '',
    text: (plain.text as string) ?? ''
  };
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const commentsInclude = { model: db.MarketingRequestComment, as: 'comments' };

function toRecord(row: Model): MarketingRequestRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    comments: ((plain.comments as Record<string, unknown>[]) ?? [])
      .map(rowToComment)
      .sort((a, b) => (a.at < b.at ? -1 : 1))
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'json') record[name] = name === 'timeline' ? (raw ?? null) : (raw ?? []);
    else record[name] = raw ?? '';
  }
  return record as unknown as MarketingRequestRecord;
}

async function readAll(): Promise<MarketingRequestRecord[]> {
  const rows = await db.MarketingRequest.findAll({ include: [creatorInclude, commentsInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<MarketingRequestRecord[]> {
  const where: Record<string, unknown> = {};
  if (!viewerIsPrivileged) {
    const user = await db.User.findOne({ where: { username: viewerUsername } as never });
    where.created_by = user ? user.get('id') : '00000000-0000-0000-0000-000000000000';
  }
  const rows = await db.MarketingRequest.findAll({ where: where as never, include: [creatorInclude, commentsInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function create(record: MarketingRequestRecord): Promise<MarketingRequestRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  return sequelize.transaction(async (t) => {
    const row = await db.MarketingRequest.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never, { transaction: t });
    if (record.comments?.length) {
      await db.MarketingRequestComment.bulkCreate(record.comments.map((c) => commentToRow(c, row.get('id') as string)) as never, { transaction: t });
    }
    const withAssoc = await db.MarketingRequest.findByPk(row.get('id') as string, { include: [creatorInclude, commentsInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function update(id: string, patch: Partial<MarketingRequestRecord>): Promise<MarketingRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.MarketingRequest.findByPk(id);
  if (!row) return null;

  return sequelize.transaction(async (t) => {
    const attrs: Record<string, unknown> = {};
    const patchObj = patch as unknown as Record<string, unknown>;
    for (const { name, kind = 'string' } of FIELDS) {
      if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
    }
    await row.update(attrs as never, { transaction: t });

    if (patch.comments) {
      await db.MarketingRequestComment.destroy({ where: { marketing_request_id: id } as never, transaction: t });
      if (patch.comments.length) {
        await db.MarketingRequestComment.bulkCreate(patch.comments.map((c) => commentToRow(c, id)) as never, { transaction: t });
      }
    }

    const withAssoc = await db.MarketingRequest.findByPk(id, { include: [creatorInclude, commentsInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<boolean> {
  if (!viewerIsPrivileged) return false;
  if (!isUuid(id)) return false;
  const row = await db.MarketingRequest.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export const marketingRequestStore = { list, create, update, remove, readAll };
