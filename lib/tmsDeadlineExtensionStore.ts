import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { TmsDeadlineExtensionRecord } from './types';

const INCLUDE_EXTENDED_BY = [{ model: db.User, as: 'extendedBy', attributes: ['id', 'username', 'name'] }];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): TmsDeadlineExtensionRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const extendedBy = plain.extendedBy as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    tmsProjectId: plain.tms_project_id as string,
    previousDeadline: plain.previous_deadline ? String(plain.previous_deadline) : '',
    newDeadline: String(plain.new_deadline),
    remark: (plain.remark as string) ?? '',
    attachments: Array.isArray(plain.attachments) ? (plain.attachments as string[]) : [],
    extendedByName: extendedBy?.name ?? extendedBy?.username ?? '',
    extendedByUsername: extendedBy?.username ?? '',
    createdAt: isoOrEmpty(plain.created_at)
  };
}

export async function listForProject(tmsProjectId: string): Promise<TmsDeadlineExtensionRecord[]> {
  if (!isUuid(tmsProjectId)) return [];
  const rows = await db.TmsProjectDeadlineExtension.findAll({
    where: { tms_project_id: tmsProjectId } as never,
    include: INCLUDE_EXTENDED_BY as never,
    order: [['created_at', 'DESC']]
  });
  return rows.map(toRecord);
}

export interface CreateExtensionInput {
  tmsProjectId: string;
  previousDeadline: string;
  newDeadline: string;
  remark: string;
  attachments?: string[];
  extendedByUserId: string;
}

export class InvalidDeadlineExtensionError extends Error {}

// Updates TmsProject.deadline and appends the immutable history row in one
// transaction — a partial write here (deadline moved but no history row, or
// vice versa) would defeat the entire point of an auditable extension log.
export async function createExtension(input: CreateExtensionInput): Promise<TmsDeadlineExtensionRecord> {
  const remark = input.remark.trim();
  if (!remark) throw new InvalidDeadlineExtensionError('A remark is required to extend the deadline.');
  if (input.previousDeadline && input.newDeadline <= input.previousDeadline) {
    throw new InvalidDeadlineExtensionError('The new deadline must be later than the current deadline.');
  }

  const row = await db.sequelize.transaction(async (t) => {
    const project = await db.TmsProject.findByPk(input.tmsProjectId, { transaction: t });
    if (!project) throw new InvalidDeadlineExtensionError('Project not found');
    await project.update({ deadline: input.newDeadline } as never, { transaction: t });
    return db.TmsProjectDeadlineExtension.create(
      {
        tms_project_id: input.tmsProjectId,
        previous_deadline: input.previousDeadline || null,
        new_deadline: input.newDeadline,
        remark,
        attachments: input.attachments || [],
        extended_by: input.extendedByUserId
      } as never,
      { transaction: t }
    );
  });

  const withAssoc = await db.TmsProjectDeadlineExtension.findByPk(row.get('id') as string, { include: INCLUDE_EXTENDED_BY as never });
  return toRecord(withAssoc as Model);
}
