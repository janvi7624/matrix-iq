import { AuditLogEntry, UserRole } from './types';
import { readJsonBlob, writeJsonBlob } from './blobStore';

const DATA_PATHNAME = 'data/auditLog.json';

async function readAll(): Promise<AuditLogEntry[]> {
  return readJsonBlob<AuditLogEntry[]>(DATA_PATHNAME, []);
}

async function writeAll(records: AuditLogEntry[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
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
    const records = await readAll();
    const entry: AuditLogEntry = {
      id: `${Date.now()}`,
      at: new Date().toISOString(),
      by: input.by,
      role: input.role,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      previous_status: input.previousStatus,
      new_status: input.newStatus,
      remarks: input.remarks || '',
      ip: input.ip || ''
    };
    records.push(entry);
    await writeAll(records);
  } catch {
    // never let audit logging break the actual workflow action
  }
}

export async function listAuditLog(entityType?: AuditLogEntry['entity_type'], entityId?: string): Promise<AuditLogEntry[]> {
  const records = await readAll();
  const sorted = [...records].sort((a, b) => (a.at < b.at ? 1 : -1));
  return sorted.filter((r) => (!entityType || r.entity_type === entityType) && (!entityId || r.entity_id === entityId));
}
