import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { DeadlineApprovalTier } from './tmsDeadlineExtensionStore';
import { DeadlineExtensionReason, TmsTaskDeadlineExtensionRecord } from './types';

// Extending a TMS task's due date. Deliberately the same shape as
// lib/tmsDeadlineExtensionStore.ts (the project-level one) rather than a
// lighter "just log the change" record like general tasks get, because a TMS
// task's due_date is SCORED: lib/departmentScoring.ts counts every task
// assigned to someone as on-time, late, or overdue-and-open against that date
// and rolls the result into the department health gauge. Moving a date
// therefore moves a score, so it goes through the same approval chain.
//
// The task's own due_date is written only when a request reaches 'approved' —
// never on request — so the date on screen always has an approved reason
// behind it.

export type { DeadlineApprovalTier };

const INCLUDES = [
  { model: db.User, as: 'extendedBy', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'approvedBy', attributes: ['id', 'username', 'name'] }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): TmsTaskDeadlineExtensionRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const extendedBy = plain.extendedBy as { username?: string; name?: string } | null;
  const approvedBy = plain.approvedBy as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    taskId: plain.task_id as string,
    previousDeadline: plain.previous_deadline ? String(plain.previous_deadline) : '',
    newDeadline: String(plain.new_deadline),
    reason: plain.reason as DeadlineExtensionReason,
    remark: (plain.remark as string) ?? '',
    attachments: Array.isArray(plain.attachments) ? (plain.attachments as string[]) : [],
    status: plain.status as TmsTaskDeadlineExtensionRecord['status'],
    extendedByName: extendedBy?.name ?? extendedBy?.username ?? '',
    extendedByUsername: extendedBy?.username ?? '',
    approvedByName: approvedBy?.name ?? approvedBy?.username ?? '',
    approvedByUsername: approvedBy?.username ?? '',
    approvedAt: isoOrEmpty(plain.approved_at),
    decisionRemark: (plain.decision_remark as string) ?? '',
    createdAt: isoOrEmpty(plain.created_at)
  };
}

export async function listForTask(taskId: string): Promise<TmsTaskDeadlineExtensionRecord[]> {
  if (!isUuid(taskId)) return [];
  const rows = await db.TmsTaskDeadlineExtension.findAll({
    where: { task_id: taskId } as never,
    include: INCLUDES as never,
    order: [['created_at', 'DESC']]
  });
  return rows.map(toRecord);
}

export async function findById(extensionId: string): Promise<TmsTaskDeadlineExtensionRecord | undefined> {
  if (!isUuid(extensionId)) return undefined;
  const row = await db.TmsTaskDeadlineExtension.findByPk(extensionId, { include: INCLUDES as never });
  return row ? toRecord(row) : undefined;
}

export interface RequestTaskExtensionInput {
  taskId: string;
  previousDeadline: string;
  newDeadline: string;
  reason: DeadlineExtensionReason;
  remark: string;
  attachments?: string[];
  requestedByUserId: string;
  requesterTier: DeadlineApprovalTier;
}

export class InvalidTaskDeadlineExtensionError extends Error {}

// Tiering, deliberately looser than the project-level flow:
//
//   'plain'  (engineer / technician) -> pending_manager; their manager grants it
//   'manager'                        -> applied immediately
//   'admin'                          -> applied immediately
//
// A manager does NOT wait on an Admin here, unlike the project flow. A task
// date slipping is routine delivery management, and making a manager queue
// behind an admin for it only teaches people to work around the feature.
// What replaces that gate is the record: the reason is mandatory for every
// tier, and every extension — including a self-approved one — writes an
// immutable row plus an audit entry naming who moved it, from what, to what,
// and why. An admin reviews after the fact and can ask, instead of being a
// checkpoint in front of it.
//
// 'pending_admin' stays in the enum and stays handled by decideTaskExtension:
// rows already in that state must remain decidable, and the project-level
// flow still produces it.
export async function requestTaskExtension(input: RequestTaskExtensionInput): Promise<TmsTaskDeadlineExtensionRecord> {
  // Mandatory for every tier, including the two that self-approve — for
  // those the written reason IS the control, so an empty one would leave an
  // admin reviewing a date change with nothing to review.
  const remark = input.remark.trim();
  if (!remark) throw new InvalidTaskDeadlineExtensionError('A remark is required to extend the deadline.');
  // Only compared when there IS a previous date — a task with no due date can
  // have one set through this flow, and there is nothing to be later than.
  if (input.previousDeadline && input.newDeadline <= input.previousDeadline) {
    throw new InvalidTaskDeadlineExtensionError('The new deadline must be later than the current deadline.');
  }

  const isAutoApproved = input.requesterTier === 'admin' || input.requesterTier === 'manager';
  const status = isAutoApproved ? 'approved' : 'pending_manager';

  const row = await db.sequelize.transaction(async (t) => {
    const task = await db.TmsTask.findByPk(input.taskId, { transaction: t });
    if (!task) throw new InvalidTaskDeadlineExtensionError('Task not found');
    if (isAutoApproved) await task.update({ due_date: input.newDeadline } as never, { transaction: t });
    return db.TmsTaskDeadlineExtension.create(
      {
        task_id: input.taskId,
        previous_deadline: input.previousDeadline || null,
        new_deadline: input.newDeadline,
        reason: input.reason,
        remark,
        attachments: input.attachments || [],
        extended_by: input.requestedByUserId,
        status,
        approved_by: isAutoApproved ? input.requestedByUserId : null,
        approved_at: isAutoApproved ? new Date() : null
      } as never,
      { transaction: t }
    );
  });

  const withAssoc = await db.TmsTaskDeadlineExtension.findByPk(row.get('id') as string, { include: INCLUDES as never });
  return toRecord(withAssoc as Model);
}

export interface DecideTaskExtensionInput {
  extensionId: string;
  decision: 'approve' | 'reject';
  deciderUserId: string;
  deciderTier: DeadlineApprovalTier;
  decisionRemark?: string;
}

// pending_manager -> decidable by manager or admin; pending_admin -> admin
// only. Approving writes the task's due_date in the same transaction as the
// status flip, so the two can never disagree; rejecting never touches the task.
export async function decideTaskExtension(input: DecideTaskExtensionInput): Promise<TmsTaskDeadlineExtensionRecord> {
  if (!isUuid(input.extensionId)) throw new InvalidTaskDeadlineExtensionError('Extension not found');
  const decisionRemark = (input.decisionRemark || '').trim();
  if (input.decision === 'reject' && !decisionRemark) {
    throw new InvalidTaskDeadlineExtensionError('A remark is required to reject an extension request.');
  }

  const row = await db.sequelize.transaction(async (t) => {
    const extension = await db.TmsTaskDeadlineExtension.findByPk(input.extensionId, { transaction: t });
    if (!extension) throw new InvalidTaskDeadlineExtensionError('Extension not found');
    const status = extension.get('status') as string;

    if (status === 'pending_manager') {
      if (input.deciderTier !== 'manager' && input.deciderTier !== 'admin') {
        throw new InvalidTaskDeadlineExtensionError('Only a Manager or Admin can decide this request.');
      }
    } else if (status === 'pending_admin') {
      if (input.deciderTier !== 'admin') {
        throw new InvalidTaskDeadlineExtensionError('Only an Admin can decide this request.');
      }
    } else {
      throw new InvalidTaskDeadlineExtensionError('This request has already been decided.');
    }

    const newStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    await extension.update(
      { status: newStatus, approved_by: input.deciderUserId, approved_at: new Date(), decision_remark: decisionRemark } as never,
      { transaction: t }
    );

    if (input.decision === 'approve') {
      const task = await db.TmsTask.findByPk(extension.get('task_id') as string, { transaction: t });
      if (task) await task.update({ due_date: extension.get('new_deadline') } as never, { transaction: t });
    }

    return extension;
  });

  const withAssoc = await db.TmsTaskDeadlineExtension.findByPk(row.get('id') as string, { include: INCLUDES as never });
  return toRecord(withAssoc as Model);
}
