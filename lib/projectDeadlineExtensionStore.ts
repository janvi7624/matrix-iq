import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { DeadlineExtensionReason, ProjectDeadlineExtensionRecord } from './types';

export type DeadlineApprovalTier = 'plain' | 'manager' | 'admin';

const INCLUDES = [
  { model: db.User, as: 'requestedBy', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'approvedBy', attributes: ['id', 'username', 'name'] }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): ProjectDeadlineExtensionRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const requestedBy = plain.requestedBy as { username?: string; name?: string } | null;
  const approvedBy = plain.approvedBy as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    projectId: plain.project_id as string,
    previousDeadline: plain.previous_deadline ? String(plain.previous_deadline) : '',
    newDeadline: String(plain.new_deadline),
    reason: plain.reason as DeadlineExtensionReason,
    remark: (plain.remark as string) ?? '',
    status: plain.status as ProjectDeadlineExtensionRecord['status'],
    requestedByName: requestedBy?.name ?? requestedBy?.username ?? '',
    requestedByUsername: requestedBy?.username ?? '',
    approvedByName: approvedBy?.name ?? approvedBy?.username ?? '',
    approvedByUsername: approvedBy?.username ?? '',
    approvedAt: isoOrEmpty(plain.approved_at),
    decisionRemark: (plain.decision_remark as string) ?? '',
    createdAt: isoOrEmpty(plain.created_at)
  };
}

export async function listForProject(projectId: string): Promise<ProjectDeadlineExtensionRecord[]> {
  if (!isUuid(projectId)) return [];
  const rows = await db.ProjectDeadlineExtension.findAll({
    where: { project_id: projectId } as never,
    include: INCLUDES as never,
    order: [['created_at', 'DESC']]
  });
  return rows.map(toRecord);
}

export async function findById(extensionId: string): Promise<ProjectDeadlineExtensionRecord | undefined> {
  if (!isUuid(extensionId)) return undefined;
  const row = await db.ProjectDeadlineExtension.findByPk(extensionId, { include: INCLUDES as never });
  return row ? toRecord(row) : undefined;
}

export interface RequestExtensionInput {
  projectId: string;
  previousDeadline: string;
  newDeadline: string;
  reason: DeadlineExtensionReason;
  remark: string;
  requestedByUserId: string;
  requesterTier: DeadlineApprovalTier;
}

export class InvalidDeadlineExtensionError extends Error {}

// Same shape as lib/tmsDeadlineExtensionStore.ts's requestExtension — a
// 'plain' requester's row starts 'pending_manager'; a 'manager' requester's
// row starts 'pending_admin'; an 'admin' requester is auto-approved and
// Project.expected_closing_date is updated immediately, in the same
// transaction.
export async function requestExtension(input: RequestExtensionInput): Promise<ProjectDeadlineExtensionRecord> {
  const remark = input.remark.trim();
  if (!remark) throw new InvalidDeadlineExtensionError('A remark is required to extend the deadline.');
  if (input.previousDeadline && input.newDeadline <= input.previousDeadline) {
    throw new InvalidDeadlineExtensionError('The new deadline must be later than the current deadline.');
  }

  const isAutoApproved = input.requesterTier === 'admin';
  const status = isAutoApproved ? 'approved' : input.requesterTier === 'manager' ? 'pending_admin' : 'pending_manager';

  const row = await db.sequelize.transaction(async (t) => {
    const project = await db.Project.findByPk(input.projectId, { transaction: t });
    if (!project) throw new InvalidDeadlineExtensionError('Project not found');
    if (isAutoApproved) await project.update({ expected_closing_date: input.newDeadline } as never, { transaction: t });
    return db.ProjectDeadlineExtension.create(
      {
        project_id: input.projectId,
        previous_deadline: input.previousDeadline || null,
        new_deadline: input.newDeadline,
        reason: input.reason,
        remark,
        requested_by: input.requestedByUserId,
        status,
        approved_by: isAutoApproved ? input.requestedByUserId : null,
        approved_at: isAutoApproved ? new Date() : null
      } as never,
      { transaction: t }
    );
  });

  const withAssoc = await db.ProjectDeadlineExtension.findByPk(row.get('id') as string, { include: INCLUDES as never });
  return toRecord(withAssoc as Model);
}

export interface DecideExtensionInput {
  extensionId: string;
  decision: 'approve' | 'reject';
  deciderUserId: string;
  deciderTier: DeadlineApprovalTier;
  decisionRemark?: string;
}

export async function decideExtension(input: DecideExtensionInput): Promise<ProjectDeadlineExtensionRecord> {
  if (!isUuid(input.extensionId)) throw new InvalidDeadlineExtensionError('Extension not found');
  const decisionRemark = (input.decisionRemark || '').trim();
  if (input.decision === 'reject' && !decisionRemark) {
    throw new InvalidDeadlineExtensionError('A remark is required to reject an extension request.');
  }

  const row = await db.sequelize.transaction(async (t) => {
    const extension = await db.ProjectDeadlineExtension.findByPk(input.extensionId, { transaction: t });
    if (!extension) throw new InvalidDeadlineExtensionError('Extension not found');
    const status = extension.get('status') as string;

    if (status === 'pending_manager') {
      if (input.deciderTier !== 'manager' && input.deciderTier !== 'admin') {
        throw new InvalidDeadlineExtensionError('Only a Manager or Admin can decide this request.');
      }
    } else if (status === 'pending_admin') {
      if (input.deciderTier !== 'admin') {
        throw new InvalidDeadlineExtensionError('Only an Admin can decide this request.');
      }
    } else {
      throw new InvalidDeadlineExtensionError('This request has already been decided.');
    }

    const newStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    await extension.update(
      { status: newStatus, approved_by: input.deciderUserId, approved_at: new Date(), decision_remark: decisionRemark } as never,
      { transaction: t }
    );

    if (input.decision === 'approve') {
      const project = await db.Project.findByPk(extension.get('project_id') as string, { transaction: t });
      if (project) await project.update({ expected_closing_date: extension.get('new_deadline') } as never, { transaction: t });
    }

    return extension;
  });

  const withAssoc = await db.ProjectDeadlineExtension.findByPk(row.get('id') as string, { include: INCLUDES as never });
  return toRecord(withAssoc as Model);
}
