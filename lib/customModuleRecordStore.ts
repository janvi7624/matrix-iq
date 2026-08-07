import { Model } from 'sequelize';
import { CustomModuleDef, CustomModuleRecord, CustomRecordStatus } from './types';
import { db, isUuid } from './db';
import { ViewerContext } from './viewerContext';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };

function toRecord(row: Model): CustomModuleRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    status: plain.status as CustomRecordStatus,
    values: (plain.values as Record<string, unknown>) ?? {},
    attachments: (plain.attachments as string[]) ?? []
  };
}

// Same "privileged sees everything, everyone else sees only their own" rule
// as every other module — plus, when the module requires approval, the
// designated approver role can also see records still pending their
// decision (otherwise they'd have no way to find what needs approving).
export async function listCustomModuleRecords(def: CustomModuleDef, viewer: ViewerContext): Promise<CustomModuleRecord[]> {
  const isApproverForPending = def.requiresApproval && def.approverRole && viewer.role === def.approverRole;
  const rows = await db.CustomModuleRecord.findAll({ where: { customModuleId: def.id } as never, include: [creatorInclude], order: [['createdAt', 'DESC']] });
  const records = rows.map(toRecord);
  if (viewer.isPrivileged) return records;
  return records.filter((r) => r.created_by === viewer.username || (isApproverForPending && r.status === 'pending_approval'));
}

export async function findCustomModuleRecordById(moduleKey: string, id: string): Promise<CustomModuleRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const def = await db.CustomModule.findOne({ where: { key: moduleKey } as never });
  if (!def) return undefined;
  const row = await db.CustomModuleRecord.findOne({ where: { id, customModuleId: def.get('id') } as never, include: [creatorInclude] });
  return row ? toRecord(row) : undefined;
}

export async function createCustomModuleRecord(def: CustomModuleDef, values: Record<string, unknown>, attachments: string[], createdBy: string): Promise<CustomModuleRecord> {
  const creator = await db.User.findOne({ where: { username: createdBy } as never });
  const row = await db.CustomModuleRecord.create({
    customModuleId: def.id,
    createdBy: creator ? creator.get('id') : null,
    status: def.requiresApproval ? 'pending_approval' : 'active',
    values,
    attachments
  } as never);
  const withAssoc = await db.CustomModuleRecord.findByPk(row.get('id') as string, { include: [creatorInclude] });
  return toRecord(withAssoc as Model);
}

export async function updateCustomModuleRecord(moduleKey: string, id: string, patch: { values?: Record<string, unknown>; attachments?: string[]; status?: CustomRecordStatus }): Promise<CustomModuleRecord | null> {
  if (!isUuid(id)) return null;
  const def = await db.CustomModule.findOne({ where: { key: moduleKey } as never });
  if (!def) return null;
  const row = await db.CustomModuleRecord.findOne({ where: { id, customModuleId: def.get('id') } as never });
  if (!row) return null;
  await row.update({ values: patch.values, attachments: patch.attachments, status: patch.status } as never);
  const withAssoc = await db.CustomModuleRecord.findByPk(id, { include: [creatorInclude] });
  return toRecord(withAssoc as Model);
}

export async function deleteCustomModuleRecord(moduleKey: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const def = await db.CustomModule.findOne({ where: { key: moduleKey } as never });
  if (!def) return false;
  const row = await db.CustomModuleRecord.findOne({ where: { id, customModuleId: def.get('id') } as never });
  if (!row) return false;
  await row.destroy();
  return true;
}
