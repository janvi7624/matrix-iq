import { Model } from 'sequelize';
import { RoleRecord, RolePermissions } from './types';
import { db, isUuid } from './db';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function blankPermissions(overrides: Partial<RolePermissions> = {}): RolePermissions {
  return { modules: {}, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, ...overrides };
}

// The 6 roles this app already had before Role Management became dynamic —
// seeded with the exact isPrivileged tier and manage* capabilities proxy.ts /
// the admin routes already granted them, so seeding this store changes
// nothing about how an existing account behaves.
const SEED_ROLES: { key: string; label: string; description: string; isSystem: boolean; isPrivileged: boolean; status: 'active'; order: number; permissions: RolePermissions }[] = [
  { key: 'superadmin', label: 'Super Admin', description: 'Full rights — manage users, roles, departments, settings; only role that can delete records.', isSystem: true, isPrivileged: true, status: 'active', order: 1, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true }) },
  { key: 'admin', label: 'Admin', description: 'Creates/edits users and manages configuration; cannot delete users or quotations.', isSystem: true, isPrivileged: true, status: 'active', order: 2, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true }) },
  { key: 'manager', label: 'Manager', description: 'Same broad pipeline visibility as Admin across projects, demos, and approvals.', isSystem: true, isPrivileged: true, status: 'active', order: 3, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true }) },
  { key: 'technical', label: 'Technical Team', description: 'Own-scoped visibility; approves technical availability for demo requests.', isSystem: true, isPrivileged: false, status: 'active', order: 4, permissions: blankPermissions() },
  { key: 'backoffice', label: 'Back Office', description: 'Prepares, dispatches, and closes Delivery Challans.', isSystem: true, isPrivileged: false, status: 'active', order: 5, permissions: blankPermissions() },
  { key: 'user', label: 'User', description: 'Creates quotations, site visits, and demo requests; own-scoped visibility only.', isSystem: true, isPrivileged: false, status: 'active', order: 6, permissions: blankPermissions() }
];

async function ensureSeeded(): Promise<void> {
  const count = await db.Role.count();
  if (count === 0) {
    await db.Role.bulkCreate(SEED_ROLES.map((r) => ({ ...r })) as never);
    return;
  }
  // A built-in role missing from an already-persisted table (e.g. this store
  // didn't exist yet when the table was first seeded) — reconcile it in
  // without touching anything an admin already customized.
  const existingKeys = new Set((await db.Role.findAll({ attributes: ['key'] })).map((r) => r.get('key') as string));
  const missing = SEED_ROLES.filter((r) => !existingKeys.has(r.key));
  if (missing.length) await db.Role.bulkCreate(missing.map((r) => ({ ...r })) as never);
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const updaterInclude = { model: db.User, as: 'updater', attributes: ['id', 'username'] };

function toRecord(row: Model): RoleRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    key: plain.key as string,
    label: (plain.label as string) ?? '',
    description: (plain.description as string) ?? '',
    isSystem: plain.isSystem as boolean,
    isPrivileged: plain.isPrivileged as boolean,
    status: plain.status as RoleRecord['status'],
    order: plain.order as number,
    permissions: (plain.permissions as RolePermissions) ?? blankPermissions(),
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    updated_by: (plain.updater as { username?: string } | null)?.username ?? ''
  };
}

export async function listRoles(): Promise<RoleRecord[]> {
  await ensureSeeded();
  const rows = await db.Role.findAll({ include: [creatorInclude, updaterInclude], order: [['order', 'ASC']] });
  return rows.map(toRecord);
}

export async function listActiveRoles(): Promise<RoleRecord[]> {
  const records = await listRoles();
  return records.filter((r) => r.status === 'active');
}

export async function findRoleById(id: string): Promise<RoleRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Role.findByPk(id, { include: [creatorInclude, updaterInclude] });
  return row ? toRecord(row) : undefined;
}

export async function findRoleByKey(key: string): Promise<RoleRecord | undefined> {
  const row = await db.Role.findOne({ where: { key } as never, include: [creatorInclude, updaterInclude] });
  return row ? toRecord(row) : undefined;
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
  await ensureSeeded();
  // paranoid:false — the unique index on `key` isn't partial (doesn't
  // exclude soft-deleted rows), so a slug that collides with a previously
  // *deleted* role would still hit a raw Postgres unique-violation below
  // instead of picking a free suffix like it does for an active collision.
  const existingKeys = new Set((await db.Role.findAll({ attributes: ['key'], paranoid: false })).map((r) => r.get('key') as string));
  let key = slugify(input.label);
  let suffix = 1;
  while (existingKeys.has(key)) {
    key = `${slugify(input.label)}-${++suffix}`;
  }
  const maxOrder = ((await db.Role.max('order')) as number) || 0;
  const creator = await db.User.findOne({ where: { username: createdBy } as never });

  const row = await db.Role.create({
    key,
    label: input.label,
    description: input.description || '',
    isSystem: false,
    isPrivileged: input.isPrivileged ?? false,
    status: 'active',
    order: maxOrder + 1,
    permissions: input.permissions ?? blankPermissions(),
    createdBy: creator ? creator.get('id') : null,
    updatedBy: creator ? creator.get('id') : null
  } as never);

  return (await findRoleById(row.get('id') as string)) as RoleRecord;
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
  if (!isUuid(id)) return null;
  const row = await db.Role.findByPk(id);
  if (!row) return null;
  const updater = await db.User.findOne({ where: { username: updatedBy } as never });
  await row.update(
    {
      label: patch.label,
      description: patch.description,
      isPrivileged: patch.isPrivileged,
      status: patch.status,
      permissions: patch.permissions,
      updatedBy: updater ? updater.get('id') : null
    } as never
  );
  return (await findRoleById(id)) ?? null;
}

export async function isRoleAssigned(key: string): Promise<boolean> {
  const role = await db.Role.findOne({ where: { key } as never });
  if (!role) return false;
  const count = await db.User.count({ where: { roleId: role.get('id') } as never });
  return count > 0;
}

export async function deleteRole(id: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isUuid(id)) return { ok: false, reason: 'Role not found' };
  const row = await db.Role.findByPk(id);
  if (!row) return { ok: false, reason: 'Role not found' };
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  if (plain.isSystem) return { ok: false, reason: 'Built-in roles cannot be deleted' };
  if (await isRoleAssigned(plain.key as string)) return { ok: false, reason: 'Role is assigned to one or more users — deactivate it instead' };
  await row.destroy();
  return { ok: true };
}
