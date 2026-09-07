import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { GeneralTaskDeadlineChangeRecord } from './types';

const INCLUDE_CHANGED_BY = [{ model: db.User, as: 'changedBy', attributes: ['id', 'username', 'name'] }];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): GeneralTaskDeadlineChangeRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const changedBy = plain.changedBy as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    taskId: plain.task_id as string,
    previousDeadline: String(plain.previous_deadline),
    newDeadline: String(plain.new_deadline),
    remark: (plain.remark as string) ?? '',
    changedByName: changedBy?.name ?? changedBy?.username ?? '',
    changedByUsername: changedBy?.username ?? '',
    createdAt: isoOrEmpty(plain.created_at)
  };
}

export async function listForTask(taskId: string): Promise<GeneralTaskDeadlineChangeRecord[]> {
  if (!isUuid(taskId)) return [];
  const rows = await db.GeneralTaskDeadlineChange.findAll({
    where: { task_id: taskId } as never,
    include: INCLUDE_CHANGED_BY as never,
    order: [['created_at', 'DESC']]
  });
  return rows.map(toRecord);
}

export class InvalidDeadlineChangeError extends Error {}

// Same validation as lib/tmsDeadlineExtensionStore.ts: new deadline must be
// strictly later, remark mandatory, both updated in one transaction so the
// task's live deadline and its history can never drift apart.
export async function changeDeadline(input: {
  taskId: string;
  previousDeadline: string;
  newDeadline: string;
  remark: string;
  changedByUserId: string;
}): Promise<GeneralTaskDeadlineChangeRecord> {
  const remark = input.remark.trim();
  if (!remark) throw new InvalidDeadlineChangeError('A remark is required to change the deadline.');
  if (input.newDeadline <= input.previousDeadline) {
    throw new InvalidDeadlineChangeError('The new deadline must be later than the current deadline.');
  }

  const row = await db.sequelize.transaction(async (t) => {
    const task = await db.GeneralTask.findByPk(input.taskId, { transaction: t });
    if (!task) throw new InvalidDeadlineChangeError('Task not found');
    await task.update({ deadline: input.newDeadline } as never, { transaction: t });
    return db.GeneralTaskDeadlineChange.create(
      {
        task_id: input.taskId,
        previous_deadline: input.previousDeadline,
        new_deadline: input.newDeadline,
        remark,
        changed_by: input.changedByUserId
      } as never,
      { transaction: t }
    );
  });

  const withAssoc = await db.GeneralTaskDeadlineChange.findByPk(row.get('id') as string, { include: INCLUDE_CHANGED_BY as never });
  return toRecord(withAssoc as Model);
}
