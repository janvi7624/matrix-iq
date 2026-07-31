import { readJsonBlob, writeJsonBlob } from './blobStore';
import { CustomModuleDef, CustomModuleRecord, CustomRecordStatus } from './types';
import { ViewerContext } from './viewerContext';

function pathnameFor(moduleKey: string): string {
  return `data/customModuleRecords/${moduleKey}.json`;
}

async function readAll(moduleKey: string): Promise<CustomModuleRecord[]> {
  return readJsonBlob<CustomModuleRecord[]>(pathnameFor(moduleKey), []);
}

async function writeAll(moduleKey: string, records: CustomModuleRecord[]): Promise<void> {
  await writeJsonBlob(pathnameFor(moduleKey), records);
}

// Same "privileged sees everything, everyone else sees only their own" rule
// as every other module — plus, when the module requires approval, the
// designated approver role can also see records still pending their
// decision (otherwise they'd have no way to find what needs approving).
export async function listCustomModuleRecords(def: CustomModuleDef, viewer: ViewerContext): Promise<CustomModuleRecord[]> {
  const records = await readAll(def.key);
  const isApproverForPending = def.requiresApproval && def.approverRole && viewer.role === def.approverRole;
  const scoped = viewer.isPrivileged
    ? records
    : records.filter((r) => r.created_by === viewer.username || (isApproverForPending && r.status === 'pending_approval'));
  return [...scoped].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function findCustomModuleRecordById(moduleKey: string, id: string): Promise<CustomModuleRecord | undefined> {
  const records = await readAll(moduleKey);
  return records.find((r) => r.id === id);
}

export async function createCustomModuleRecord(def: CustomModuleDef, values: Record<string, unknown>, attachments: string[], createdBy: string): Promise<CustomModuleRecord> {
  const records = await readAll(def.key);
  const now = new Date().toISOString();
  const record: CustomModuleRecord = {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    created_at: now,
    created_by: createdBy,
    updated_at: now,
    status: def.requiresApproval ? 'pending_approval' : 'active',
    values,
    attachments
  };
  records.push(record);
  await writeAll(def.key, records);
  return record;
}

export async function updateCustomModuleRecord(moduleKey: string, id: string, patch: { values?: Record<string, unknown>; attachments?: string[]; status?: CustomRecordStatus }): Promise<CustomModuleRecord | null> {
  const records = await readAll(moduleKey);
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) return null;
  const updated: CustomModuleRecord = {
    ...records[index],
    values: patch.values ?? records[index].values,
    attachments: patch.attachments ?? records[index].attachments,
    status: patch.status ?? records[index].status,
    updated_at: new Date().toISOString()
  };
  records[index] = updated;
  await writeAll(moduleKey, records);
  return updated;
}

export async function deleteCustomModuleRecord(moduleKey: string, id: string): Promise<boolean> {
  const records = await readAll(moduleKey);
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  await writeAll(moduleKey, next);
  return true;
}
