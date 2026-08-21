import { Model, Op } from 'sequelize';
import { MarketingRequestComment, MarketingRequestRecord } from './types';
import { db, isUuid, sequelize } from './db';

const FIELDS = [
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'title' },
  { name: 'product_category', kind: 'nullable' as const },
  { name: 'request_type', kind: 'nullable' as const },
  { name: 'description' },
  { name: 'additional_info' },
  { name: 'priority' },
  { name: 'needed_by_date', kind: 'nullable' as const },
  { name: 'attachments', kind: 'json' as const },
  { name: 'status' },
  { name: 'marketing_prepared_content' },
  { name: 'marketing_attachments', kind: 'json' as const },
  { name: 'marketing_remarks' },
  { name: 'technical_instructions' },
  { name: 'technical_review_decision' },
  { name: 'technical_remarks' },
  { name: 'technical_reviewed_at', kind: 'nullable' as const },
  { name: 'technical_reviewed_by' },
  { name: 'final_submission_notes' },
  { name: 'final_submission_files', kind: 'json' as const },
  { name: 'timeline', kind: 'json' as const },
  { name: 'rejection_reason' },
  { name: 'completion_notes' },
  { name: 'delivered_files', kind: 'json' as const },
  { name: 'technical_assigned_to' }
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

function rowToComment(plain: Record<string, unknown>): MarketingRequestComment {
  return {
    id: plain.id as string,
    at: isoOrEmpty(plain.at),
    by: (plain.by as string) ?? '',
    text: (plain.text as string) ?? ''
  };
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] };
const assigneeInclude = { model: db.User, as: 'assignee', attributes: ['id', 'username', 'name'] };
const technicalMemberInclude = { model: db.User, as: 'technicalMember', attributes: ['id', 'username', 'name'] };
const commentsInclude = { model: db.MarketingRequestComment, as: 'comments' };
const ALL_INCLUDES = [creatorInclude, assigneeInclude, technicalMemberInclude, commentsInclude];

function toRecord(row: Model): MarketingRequestRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const creatorObj = plain.creator as { id?: string; username?: string; name?: string } | null;
  const assigneeObj = plain.assignee as { id?: string; username?: string; name?: string } | null;
  const technicalObj = plain.technicalMember as { id?: string; username?: string; name?: string } | null;

  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: creatorObj?.username || '',
    creator_name: creatorObj?.name || creatorObj?.username || '',
    assigned_to: assigneeObj?.username || '',
    assigned_to_id: (plain.assigned_to_id as string) || assigneeObj?.id || '',
    assigned_to_name: assigneeObj?.name || assigneeObj?.username || '',
    technical_member_id: (plain.technical_assigned_to_id as string) || technicalObj?.id || '',
    technical_member_username: technicalObj?.username || (plain.technical_assigned_to as string) || '',
    technical_member_name: technicalObj?.name || technicalObj?.username || (plain.technical_assigned_to as string) || '',
    updated_at: isoOrEmpty(plain.updatedAt),
    comments: (Array.isArray(plain.comments) ? (plain.comments as Record<string, unknown>[]) : [])
      .map(rowToComment)
      .sort((a, b) => (a.at < b.at ? -1 : 1))
  };

  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'json') record[name] = name === 'timeline' ? (raw ?? null) : (raw ?? []);
    else record[name] = raw ?? '';
  }

  // Backwards compatibility for product category if string was stored in product_categories array
  if (!record.product_category && Array.isArray(plain.product_categories) && plain.product_categories.length > 0) {
    record.product_category = plain.product_categories[0];
  }

  return record as unknown as MarketingRequestRecord;
}

async function readAll(): Promise<MarketingRequestRecord[]> {
  const rows = await db.MarketingRequest.findAll({ include: ALL_INCLUDES, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function list(viewerUsername: string, viewerIsPrivilegedOrReviewer: boolean): Promise<MarketingRequestRecord[]> {
  if (viewerIsPrivilegedOrReviewer) {
    const rows = await db.MarketingRequest.findAll({ include: ALL_INCLUDES, order: [['created_at', 'DESC']] });
    return rows.map(toRecord);
  }

  const user = await db.User.findOne({ where: { username: viewerUsername } as never });
  const userId = user ? (user.get('id') as string) : '00000000-0000-0000-0000-000000000000';

  const rows = await db.MarketingRequest.findAll({
    where: {
      [Op.or]: [
        { created_by: userId },
        { assigned_to_id: userId },
        { technical_assigned_to_id: userId }
      ]
    } as never,
    include: ALL_INCLUDES,
    order: [['created_at', 'DESC']]
  });
  return rows.map(toRecord);
}

async function create(record: MarketingRequestRecord): Promise<MarketingRequestRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);

  const creator = await db.User.findOne({ where: { username: record.created_by } as never });
  const assignee = record.assigned_to ? await db.User.findOne({ where: { username: record.assigned_to } as never }) : null;
  const technicalMember = record.technical_member_id
    ? await db.User.findByPk(record.technical_member_id)
    : record.technical_member_username
      ? await db.User.findOne({ where: { username: record.technical_member_username } as never })
      : null;

  return sequelize.transaction(async (t) => {
    const row = await db.MarketingRequest.create(
      {
        ...attrs,
        created_by: creator ? creator.get('id') : null,
        assigned_to_id: assignee ? assignee.get('id') : (record.assigned_to_id || null),
        technical_assigned_to_id: technicalMember ? technicalMember.get('id') : (record.technical_member_id || null),
        technical_assigned_to: technicalMember ? technicalMember.get('name') || technicalMember.get('username') : record.technical_member_name || ''
      } as never,
      { transaction: t }
    );

    if (record.comments?.length) {
      await db.MarketingRequestComment.bulkCreate(record.comments.map((c) => commentToRow(c, row.get('id') as string)) as never, { transaction: t });
    }
    const withAssoc = await db.MarketingRequest.findByPk(row.get('id') as string, { include: ALL_INCLUDES, transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function assign(id: string, assigneeId: string | null): Promise<MarketingRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.MarketingRequest.findByPk(id);
  if (!row) return null;
  const currentStatus = row.get('status') as string;
  const newStatus = assigneeId && currentStatus === 'submitted' ? 'marketing_in_progress' : currentStatus;
  await row.update({ assigned_to_id: assigneeId, status: newStatus } as never);
  const withAssoc = await db.MarketingRequest.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
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

    if (patch.assigned_to_id !== undefined) {
      attrs.assigned_to_id = patch.assigned_to_id || null;
    }
    if (patch.technical_member_id !== undefined) {
      attrs.technical_assigned_to_id = patch.technical_member_id || null;
      if (patch.technical_member_name) {
        attrs.technical_assigned_to = patch.technical_member_name;
      }
    }

    await row.update(attrs as never, { transaction: t });

    if (patch.comments) {
      await db.MarketingRequestComment.destroy({ where: { marketing_request_id: id } as never, transaction: t });
      if (patch.comments.length) {
        await db.MarketingRequestComment.bulkCreate(patch.comments.map((c) => commentToRow(c, id)) as never, { transaction: t });
      }
    }

    const withAssoc = await db.MarketingRequest.findByPk(id, { include: ALL_INCLUDES, transaction: t });
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

export const marketingRequestStore = { list, create, update, remove, readAll, assign };
