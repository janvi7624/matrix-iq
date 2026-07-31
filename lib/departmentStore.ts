import { readJsonBlob, writeJsonBlob } from './blobStore';
import { DepartmentRecord } from './types';
import { listUsers } from './userStore';

const DATA_PATHNAME = 'data/departments.json';

// First-run seed only — from here on, Super Admin manages departments entirely
// from /admin/departments. No department name is hardcoded anywhere else in
// the app; the User form's Department field reads from this list.
const SEED_NAMES = ['Sales', 'Technical', 'Back Office', 'Accounts', 'HR', 'Purchase', 'Inventory', 'Marketing', 'Management', 'Administration'];

async function readAll(): Promise<DepartmentRecord[]> {
  const stored = await readJsonBlob<DepartmentRecord[]>(DATA_PATHNAME, []);
  if (stored.length > 0) return stored;
  const now = new Date().toISOString();
  const seeded: DepartmentRecord[] = SEED_NAMES.map((name, i) => ({
    id: `seed-${i}`,
    name,
    description: '',
    order: i + 1,
    status: 'active',
    created_at: now,
    created_by: 'system',
    updated_at: now,
    updated_by: 'system'
  }));
  await writeJsonBlob(DATA_PATHNAME, seeded);
  return seeded;
}

async function writeAll(records: DepartmentRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export async function listDepartments(): Promise<DepartmentRecord[]> {
  const records = await readAll();
  return [...records].sort((a, b) => a.order - b.order);
}

export async function listActiveDepartments(): Promise<DepartmentRecord[]> {
  const records = await listDepartments();
  return records.filter((d) => d.status === 'active');
}

export async function findDepartmentById(id: string): Promise<DepartmentRecord | undefined> {
  const records = await readAll();
  return records.find((d) => d.id === id);
}

export interface DepartmentInput {
  name: string;
  description?: string;
}

export async function createDepartment(input: DepartmentInput, createdBy: string): Promise<DepartmentRecord> {
  const records = await readAll();
  const now = new Date().toISOString();
  const maxOrder = records.reduce((acc, d) => Math.max(acc, d.order), 0);
  const record: DepartmentRecord = {
    id: `${Date.now()}`,
    name: input.name,
    description: input.description || '',
    order: maxOrder + 1,
    status: 'active',
    created_at: now,
    created_by: createdBy,
    updated_at: now,
    updated_by: createdBy
  };
  records.push(record);
  await writeAll(records);
  return record;
}

export interface DepartmentUpdateInput {
  name?: string;
  description?: string;
  status?: DepartmentRecord['status'];
}

export async function updateDepartment(id: string, patch: DepartmentUpdateInput, updatedBy: string): Promise<DepartmentRecord | null> {
  const records = await readAll();
  const index = records.findIndex((d) => d.id === id);
  if (index === -1) return null;
  records[index] = {
    ...records[index],
    name: patch.name ?? records[index].name,
    description: patch.description ?? records[index].description,
    status: patch.status ?? records[index].status,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy
  };
  await writeAll(records);
  return records[index];
}

export async function reorderDepartments(orderedIds: string[]): Promise<void> {
  const records = await readAll();
  const byId = new Map(records.map((d) => [d.id, d]));
  orderedIds.forEach((id, i) => {
    const record = byId.get(id);
    if (record) record.order = i + 1;
  });
  await writeAll([...byId.values()]);
}

// A department in use by at least one user can't be deleted (would leave
// user records pointing at a department that no longer exists) — deactivate
// it instead so it drops out of new-user dropdowns without breaking history.
export async function isDepartmentInUse(name: string): Promise<boolean> {
  const users = await listUsers();
  return users.some((u) => u.department === name);
}

export async function deleteDepartment(id: string): Promise<{ ok: boolean; reason?: string }> {
  const records = await readAll();
  const existing = records.find((d) => d.id === id);
  if (!existing) return { ok: false, reason: 'Department not found' };
  if (await isDepartmentInUse(existing.name)) {
    return { ok: false, reason: 'Department is assigned to one or more users — deactivate it instead' };
  }
  await writeAll(records.filter((d) => d.id !== id));
  return { ok: true };
}
