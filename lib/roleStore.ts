import { readJsonBlob, writeJsonBlob } from './blobStore';
import { RoleRecord, RolePermissions } from './types';
import { listUsers } from './userStore';

const DATA_PATHNAME = 'data/roles.json';

function blankPermissions(overrides: Partial<RolePermissions> = {}): RolePermissions {
  return { modules: {}, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, ...overrides };
}

// The 6 roles this app already had before Role Management became dynamic —
// seeded with the exact isPrivileged tier and manage* capabilities proxy.ts /
// the admin routes already granted them, so seeding this store changes
// nothing about how an existing account behaves. `modules: {}` (no override)
// means every module falls back to the isPrivileged tier for that role, i.e.
// zero change to Product Master / Custom Module access until an admin
// actually edits a role's matrix in Role Management.
const SEED_ROLES: Omit<RoleRecord, 'id'>[] = [
  { key: 'superadmin', label: 'Super Admin', description: 'Full rights — manage users, roles, departments, settings; only role that can delete records.', isSystem: true, isPrivileged: true, status: 'active', order: 1, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true }), created_at: '', created_by: 'system', updated_at: '', updated_by: 'system' },
  { key: 'admin', label: 'Admin', description: 'Creates/edits users and manages configuration; cannot delete users or quotations.', isSystem: true, isPrivileged: true, status: 'active', order: 2, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true }), created_at: '', created_by: 'system', updated_at: '', updated_by: 'system' },
  { key: 'manager', label: 'Manager', description: 'Same broad pipeline visibility as Admin across projects, demos, and approvals.', isSystem: true, isPrivileged: true, status: 'active', order: 3, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true }), created_at: '', created_by: 'system', updated_at: '', updated_by: 'system' },
  { key: 'technical', label: 'Technical Team', description: 'Own-scoped visibility; approves technical availability for demo requests.', isSystem: true, isPrivileged: false, status: 'active', order: 4, permissions: blankPermissions(), created_at: '', created_by: 'system', updated_at: '', updated_by: 'system' },
  { key: 'backoffice', label: 'Back Office', description: 'Prepares, dispatches, and closes Delivery Challans.', isSystem: true, isPrivileged: false, status: 'active', order: 5, permissions: blankPermissions(), created_at: '', created_by: 'system', updated_at: '', updated_by: 'system' },
  { key: 'user', label: 'User', description: 'Creates quotations, site visits, and demo requests; own-scoped visibility only.', isSystem: true, isPrivileged: false, status: 'active', order: 6, permissions: blankPermissions(), created_at: '', created_by: 'system', updated_at: '', updated_by: 'system' }
];

async function readAll(): Promise<RoleRecord[]> {
  const stored = await readJsonBlob<RoleRecord[]>(DATA_PATHNAME, []);
  if (stored.length === 0) {
    const now = new Date().toISOString();
    const seeded = SEED_ROLES.map((r, i) => ({ ...r, id: `seed-${i}`, created_at: now, updated_at: now }));
    await writeJsonBlob(DATA_PATHNAME, seeded);
    return seeded;
  }
  // A built-in role missing from an already-persisted file (e.g. this store
  // didn't exist yet when the file was first written) — reconcile it in
  // without touching anything an admin already customized.
  const existingKeys = new Set(stored.map((r) => r.key));
  const missing = SEED_ROLES.filter((r) => !existingKeys.has(r.key));
  if (missing.length === 0) return stored;
  const now = new Date().toISOString();
  const withMissing = [...stored, ...missing.map((r, i) => ({ ...r, id: `seed-new-${Date.now()}-${i}`, created_at: now, updated_at: now }))];
  await writeJsonBlob(DATA_PATHNAME, withMissing);
  return withMissing;
}

async function writeAll(records: RoleRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export async function listRoles(): Promise<RoleRecord[]> {
  const records = await readAll();
  return [...records].sort((a, b) => a.order - b.order);
}

export async function listActiveRoles(): Promise<RoleRecord[]> {
  const records = await listRoles();
  return records.filter((r) => r.status === 'active');
}

export async function findRoleById(id: string): Promise<RoleRecord | undefined> {
  const records = await readAll();
  return records.find((r) => r.id === id);
}

export async function findRoleByKey(key: string): Promise<RoleRecord | undefined> {
  const records = await readAll();
  return records.find((r) => r.key === key);
}

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `role-${Date.now()}`
  );
}

export interface RoleInput {
  label: string;
  description?: string;
  isPrivileged?: boolean;
  permissions?: RolePermissions;
}

export async function createRole(input: RoleInput, createdBy: string): Promise<RoleRecord> {
  const records = await readAll();
  let key = slugify(input.label);
  let suffix = 1;
  while (records.some((r) => r.key === key)) {
    key = `${slugify(input.label)}-${++suffix}`;
  }
  const now = new Date().toISOString();
  const maxOrder = records.reduce((acc, r) => Math.max(acc, r.order), 0);
  const record: RoleRecord = {
    id: `${Date.now()}`,
    key,
    label: input.label,
    description: input.description || '',
    isSystem: false,
    isPrivileged: input.isPrivileged ?? false,
    status: 'active',
    order: maxOrder + 1,
    permissions: input.permissions ?? blankPermissions(),
    created_at: now,
    created_by: createdBy,
    updated_at: now,
    updated_by: createdBy
  };
  records.push(record);
  await writeAll(records);
  return record;
}

export async function cloneRole(id: string, newLabel: string, createdBy: string): Promise<RoleRecord | null> {
  const source = await findRoleById(id);
  if (!source) return null;
  return createRole({ label: newLabel, description: source.description, isPrivileged: source.isPrivileged, permissions: JSON.parse(JSON.stringify(source.permissions)) }, createdBy);
}

export interface RoleUpdateInput {
  label?: string;
  description?: string;
  isPrivileged?: boolean;
  status?: RoleRecord['status'];
  permissions?: RolePermissions;
}

export async function updateRole(id: string, patch: RoleUpdateInput, updatedBy: string): Promise<RoleRecord | null> {
  const records = await readAll();
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) return null;
  records[index] = {
    ...records[index],
    label: patch.label ?? records[index].label,
    description: patch.description ?? records[index].description,
    isPrivileged: patch.isPrivileged ?? records[index].isPrivileged,
    status: patch.status ?? records[index].status,
    permissions: patch.permissions ?? records[index].permissions,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy
  };
  await writeAll(records);
  return records[index];
}

export async function isRoleAssigned(key: string): Promise<boolean> {
  const users = await listUsers();
  return users.some((u) => u.role === key);
}

export async function deleteRole(id: string): Promise<{ ok: boolean; reason?: string }> {
  const records = await readAll();
  const existing = records.find((r) => r.id === id);
  if (!existing) return { ok: false, reason: 'Role not found' };
  if (existing.isSystem) return { ok: false, reason: 'Built-in roles cannot be deleted' };
  if (await isRoleAssigned(existing.key)) return { ok: false, reason: 'Role is assigned to one or more users — deactivate it instead' };
  await writeAll(records.filter((r) => r.id !== id));
  return { ok: true };
}
