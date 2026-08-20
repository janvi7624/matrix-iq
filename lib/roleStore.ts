import { Model } from 'sequelize';
import { RoleRecord, RolePermissions } from './types';
import { db, isUuid } from './db';
import { cached, invalidateCache } from './memoCache';

// TMS module keys — kept local to this file (not imported from
// lib/tmsAccess.ts) to avoid a circular import, since tmsAccess.ts itself
// reads roles through this store.
const TMS_MODULE_KEYS = ['tms-dashboard', 'tms-projects', 'tms-tasks', 'tms-bom-requests', 'tms-procurement', 'tms-users', 'tms-tab-access'] as const;
const ALL_TMS_ACTIONS_TRUE: RolePermissions['modules'][string] = { view: true, create: true, edit: true, delete: true, export: true, print: true, approve: true, reject: true, assign: true, manage: true };

function tmsModules(perModule: () => RolePermissions['modules'][string]): RolePermissions['modules'] {
  return Object.fromEntries(TMS_MODULE_KEYS.map((k) => [k, perModule()]));
}

const TECHNICAL_MANAGER_MODULES = tmsModules(() => ({ ...ALL_TMS_ACTIONS_TRUE }));
// Team Lead: full Task management (incl. `manage`, so they see every task,
// not just their own — see lib/tmsAccess.ts's canManageAllTmsTasks), view+edit
// on Projects, create+view on BOM, view on Procurement. tms-users/tms-tab-access
// are intentionally absent -> falls back to isPrivileged (false) -> denied.
const TEAM_LEAD_MODULES: RolePermissions['modules'] = {
  'tms-dashboard': { view: true },
  'tms-projects': { view: true, edit: true },
  'tms-tasks': { view: true, create: true, edit: true, delete: true, assign: true, manage: true },
  'tms-bom-requests': { view: true, create: true },
  'tms-procurement': { view: true }
};
// Engineer: view-only Projects, own-tasks-only (no `manage`), create+view BOM,
// view Procurement.
const ENGINEER_MODULES: RolePermissions['modules'] = {
  'tms-dashboard': { view: true },
  'tms-projects': { view: true },
  'tms-tasks': { view: true, edit: true },
  'tms-bom-requests': { view: true, create: true },
  'tms-procurement': { view: true }
};
// Technician: same as Engineer, minus Procurement (no tms-procurement entry
// at all -> falls back to isPrivileged (false) -> denied).
const TECHNICIAN_MODULES: RolePermissions['modules'] = {
  'tms-dashboard': { view: true },
  'tms-projects': { view: true },
  'tms-tasks': { view: true, edit: true },
  'tms-bom-requests': { view: true, create: true }
};

const TMS_SEED_ROLES: { key: string; label: string; description: string; isSystem: boolean; isPrivileged: boolean; status: 'active'; order: number; permissions: RolePermissions }[] = [
  { key: 'technical-manager', label: 'Technical Manager', description: 'Full TMS rights — manages Projects, Tasks, BOM approvals, Procurement, technical Users, and Tab Access for Robotics/AI/AV/Marketing.', isSystem: true, isPrivileged: false, status: 'active', order: 7, permissions: { modules: TECHNICAL_MANAGER_MODULES, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, viewAllDepartments: false } },
  { key: 'team-lead', label: 'Team Lead', description: 'Full Task management, BOM creation, view-only on Projects/Procurement, within TMS.', isSystem: true, isPrivileged: false, status: 'active', order: 8, permissions: { modules: TEAM_LEAD_MODULES, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, viewAllDepartments: false } },
  { key: 'engineer', label: 'Engineer', description: 'Own-tasks visibility, BOM creation, view-only on Projects/Procurement, within TMS.', isSystem: true, isPrivileged: false, status: 'active', order: 9, permissions: { modules: ENGINEER_MODULES, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, viewAllDepartments: false } },
  { key: 'technician', label: 'Technician', description: 'Same as Engineer, without Procurement access, within TMS.', isSystem: true, isPrivileged: false, status: 'active', order: 10, permissions: { modules: TECHNICIAN_MODULES, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, viewAllDepartments: false } }
];

// Roles are edited only via Role Management (rare) but read on nearly every
// authenticated request (resolveIsPrivileged/hasCapability/isModuleActionAllowed
// all funnel through findRoleByKey). Caching the one underlying query and
// having every finder search the cached array in memory turns "2 joined
// tables read on every request" into "read once per TTL window", with every
// write path below explicitly invalidating it so an admin's change is never
// stale for longer than the in-flight request that made it.
const ROLES_CACHE_KEY = 'roles:all';
const ROLES_CACHE_TTL_MS = 30_000;

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function blankPermissions(overrides: Partial<RolePermissions> = {}): RolePermissions {
  return { modules: {}, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, viewAllDepartments: false, ...overrides };
}

// The 6 roles this app already had before Role Management became dynamic —
// seeded with the exact isPrivileged tier and manage* capabilities proxy.ts /
// the admin routes already granted them, so seeding this store changes
// nothing about how an existing account behaves.
const SEED_ROLES: { key: string; label: string; description: string; isSystem: boolean; isPrivileged: boolean; status: 'active'; order: number; permissions: RolePermissions }[] = [
  { key: 'superadmin', label: 'Super Admin', description: 'Full rights — manage users, roles, departments, settings; only role that can delete records; sees every department\'s data.', isSystem: true, isPrivileged: true, status: 'active', order: 1, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true, viewAllDepartments: true }) },
  { key: 'admin', label: 'Admin', description: 'Creates/edits users and manages configuration; cannot delete users or quotations; sees every department\'s data.', isSystem: true, isPrivileged: true, status: 'active', order: 2, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true, viewAllDepartments: true }) },
  { key: 'manager', label: 'Manager', description: 'Admin-panel access and pricing/markup rights, same as Admin; data visibility is scoped to whichever department(s) they manage in Department Master (or just their own records if none).', isSystem: true, isPrivileged: true, status: 'active', order: 3, permissions: blankPermissions({ manageSettings: true, manageUsers: true, manageRoles: true, manageDepartments: true }) },
  { key: 'technical', label: 'Technical Team', description: 'Own-scoped visibility; approves technical availability for demo requests.', isSystem: true, isPrivileged: false, status: 'active', order: 4, permissions: blankPermissions() },
  { key: 'backoffice', label: 'Back Office', description: 'Prepares, dispatches, and closes Delivery Challans.', isSystem: true, isPrivileged: false, status: 'active', order: 5, permissions: blankPermissions() },
  { key: 'user', label: 'User', description: 'Creates quotations, site visits, and demo requests; own-scoped visibility only.', isSystem: true, isPrivileged: false, status: 'active', order: 6, permissions: blankPermissions() }
];

async function ensureSeeded(): Promise<void> {
  const all = [...SEED_ROLES, ...TMS_SEED_ROLES];
  const count = await db.Role.count();
  if (count === 0) {
    await db.Role.bulkCreate(all.map((r) => ({ ...r })) as never);
    return;
  }
  // A built-in role missing from an already-persisted table (e.g. this store
  // didn't exist yet when the table was first seeded, or TMS was added
  // later) — reconcile it in without touching anything an admin already
  // customized.
  const existingKeys = new Set((await db.Role.findAll({ attributes: ['key'] })).map((r) => r.get('key') as string));
  const missing = all.filter((r) => !existingKeys.has(r.key));
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
  return cached(ROLES_CACHE_KEY, ROLES_CACHE_TTL_MS, async () => {
    await ensureSeeded();
    const rows = await db.Role.findAll({ include: [creatorInclude, updaterInclude], order: [['order', 'ASC']] });
    return rows.map(toRecord);
  });
}

export async function listActiveRoles(): Promise<RoleRecord[]> {
  const records = await listRoles();
  return records.filter((r) => r.status === 'active');
}

// Both finders read the cached list instead of issuing their own query —
// the hot path (resolveIsPrivileged, called on ~every request) no longer
// touches Postgres at all once the cache is warm.
export async function findRoleById(id: string): Promise<RoleRecord | undefined> {
  if (!isUuid(id)) return undefined;
  return (await listRoles()).find((r) => r.id === id);
}

export async function findRoleByKey(key: string): Promise<RoleRecord | undefined> {
  return (await listRoles()).find((r) => r.key === key);
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

  invalidateCache(ROLES_CACHE_KEY);
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
  invalidateCache(ROLES_CACHE_KEY);
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
  invalidateCache(ROLES_CACHE_KEY);
  return { ok: true };
}
