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

// audit_logs.action / previous_status / new_status are VARCHAR(255), and
// callers interpolate user data into them — "Lead assigned to rahul: <company>"
// where company is itself a 255-character column. Postgres rejects the whole
// INSERT on overflow, and since both writers below swallow errors to protect
// the workflow, an over-long company name silently lost the audit row. Worse
// for the batch writer: bulkCreate is ONE multi-row INSERT, so a single long
// value discarded all 600 rows of an expo assignment. A truncated line is a
// far better record than no line at all.
const FIELD_MAX = 255;
function fit(value: string): string {
  if (value.length <= FIELD_MAX) return value;
  return `${value.slice(0, FIELD_MAX - 1)}…`;
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
      action: fit(input.action),
      previous_status: fit(input.previousStatus),
      new_status: fit(input.newStatus),
      remarks: input.remarks || '',
      ip: input.ip || ''
    } as never);
  } catch {
    // never let audit logging break the actual workflow action
  }
}

// Same thing for a batch — one actor lookup and one INSERT for the whole set
// instead of two queries per entry. Assigning an expo's 600 cards writes 600
// audit rows; doing that one at a time is 1,200 round trips and times the
// request out. Never throws, exactly like logAudit.
export async function logAuditMany(entries: LogAuditInput[]): Promise<void> {
  if (!entries.length) return;
  try {
    const actors = new Map<string, unknown>();
    for (const username of new Set(entries.map((e) => e.by).filter(Boolean))) {
      const actor = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
      actors.set(username, actor ? actor.get('id') : null);
    }
    const at = new Date();
    await db.AuditLog.bulkCreate(
      entries.map((input) => ({
        at,
        by: input.by,
        actor_id: actors.get(input.by) ?? null,
        role: input.role,
        entity_type: input.entityType,
        entity_id: input.entityId || null,
        action: fit(input.action),
        previous_status: fit(input.previousStatus),
        new_status: fit(input.newStatus),
        remarks: input.remarks || '',
        ip: input.ip || ''
      })) as never
    );
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
