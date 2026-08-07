import { Model } from 'sequelize';
import { AuditLogEntry, UserRole } from './types';
import { db } from './db';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): AuditLogEntry {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    at: isoOrEmpty(plain.at),
    by: (plain.by as string) ?? '',
    role: (plain.role as UserRole) ?? '',
    entity_type: plain.entity_type as AuditLogEntry['entity_type'],
    entity_id: (plain.entity_id as string) ?? '',
    action: (plain.action as string) ?? '',
    previous_status: (plain.previous_status as string) ?? '',
    new_status: (plain.new_status as string) ?? '',
    remarks: (plain.remarks as string) ?? '',
    ip: (plain.ip as string) ?? ''
  };
}

export interface LogAuditInput {
  by: string;
  role: UserRole;
  entityType: AuditLogEntry['entity_type'];
  entityId: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  remarks?: string;
  ip?: string;
}

// Fire-and-forget style append used by every status-changing route in the
// Back Office workflow (demo approvals, DC lifecycle) — never throws, so a
// logging hiccup can't block the actual workflow action.
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    const actor = await db.User.findOne({ where: { username: input.by } as never });
    await db.AuditLog.create({
      at: new Date(),
      by: input.by,
      actor_id: actor ? actor.get('id') : null,
      role: input.role,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      action: input.action,
      previous_status: input.previousStatus,
      new_status: input.newStatus,
      remarks: input.remarks || '',
      ip: input.ip || ''
    } as never);
  } catch {
    // never let audit logging break the actual workflow action
  }
}

export async function listAuditLog(entityType?: AuditLogEntry['entity_type'], entityId?: string): Promise<AuditLogEntry[]> {
  const where: Record<string, unknown> = {};
  if (entityType) where.entity_type = entityType;
  if (entityId) where.entity_id = entityId;
  const rows = await db.AuditLog.findAll({ where: where as never, order: [['at', 'DESC']] });
  return rows.map(toRecord);
}
