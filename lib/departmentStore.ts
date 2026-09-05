import { Model, fn, col, where as sqlWhere } from 'sequelize';
import { DepartmentRecord } from './types';
import { db, isUuid } from './db';
import { cached, invalidateCache } from './memoCache';

// Departments change only via admin edits (rare) but are read on demo-
// schedule queue visibility checks, dashboard manager-routing, and approval
// notifications — several of those firing per request. Same pattern as
// roleStore.ts/moduleConfigStore.ts: cache the one underlying query, have
// every other reader search the cached list in memory, invalidate on writes.
const DEPARTMENTS_CACHE_KEY = 'departments:all';
const DEPARTMENTS_CACHE_TTL_MS = 30_000;

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

// First-run seed only — from here on, Super Admin manages departments entirely
// from /admin/departments. No department name is hardcoded anywhere else in
// the app; the User form's Department field reads from this list.
const SEED_NAMES = ['Sales', 'Technical', 'Back Office', 'Accounts', 'HR', 'Purchase', 'Inventory', 'Marketing', 'Management', 'Administration'];

// TMS (Technical Management System) departments — reconciled additively onto
// already-provisioned installs, same "missing names get bulkCreate'd"
// pattern as moduleConfigStore.ts's ensureSeededAndReconciled(). Marketing
// already exists in SEED_NAMES above and is intentionally NOT re-added here.
const TMS_DEPARTMENT_NAMES = ['Robotics', 'AI', 'AV'];

async function ensureSeeded(): Promise<void> {
  const count = await db.Department.count();
  if (count === 0) {
    await db.Department.bulkCreate([...SEED_NAMES, ...TMS_DEPARTMENT_NAMES].map((name, i) => ({ name, description: '', order: i + 1, status: 'active' })) as never);
    return;
  }
  // paranoid: false — same reasoning as createDepartment's deletedMatch
  // handling below: the unique index on `name` isn't partial, so a
  // soft-deleted row with a matching name would still collide on bulkCreate.
  const existing = await db.Department.findAll({ attributes: ['name'], paranoid: false });
  const existingNames = new Set(existing.map((d) => (d.get('name') as string).toLowerCase()));
  const missing = TMS_DEPARTMENT_NAMES.filter((n) => !existingNames.has(n.toLowerCase()));
  if (missing.length) {
    const maxOrder = ((await db.Department.max('order')) as number) || 0;
    await db.Department.bulkCreate(missing.map((name, i) => ({ name, description: '', order: maxOrder + i + 1, status: 'active' })) as never);
  }
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const updaterInclude = { model: db.User, as: 'updater', attributes: ['id', 'username'] };

function toRecord(row: Model, managerNamesById: Map<string, string>): DepartmentRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const managerIds = Array.isArray(plain.managerIds) ? (plain.managerIds as string[]) : [];
  return {
    id: plain.id as string,
    name: plain.name as string,
    description: (plain.description as string) ?? '',
    order: plain.order as number,
    status: plain.status as DepartmentRecord['status'],
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    updated_by: (plain.updater as { username?: string } | null)?.username ?? '',
    managerIds,
    managerNames: managerIds.map((id) => managerNamesById.get(id)).filter((n): n is string => !!n)
  };
}

// Batch-resolves every manager id referenced across the given rows into a
// single id -> name lookup, so listing all departments doesn't issue one
// query per row.
async function resolveManagerNames(rows: Model[]): Promise<Map<string, string>> {
  const allIds = new Set<string>();
  rows.forEach((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    (Array.isArray(plain.managerIds) ? (plain.managerIds as string[]) : []).forEach((id) => allIds.add(id));
  });
  if (!allIds.size) return new Map();
  const users = await db.User.findAll({ where: { id: [...allIds] } as never, attributes: ['id', 'name'] });
  return new Map(users.map((u) => [u.get('id') as string, u.get('name') as string]));
}

export async function listDepartments(): Promise<DepartmentRecord[]> {
  return cached(DEPARTMENTS_CACHE_KEY, DEPARTMENTS_CACHE_TTL_MS, async () => {
    await ensureSeeded();
    const rows = await db.Department.findAll({ include: [creatorInclude, updaterInclude], order: [['order', 'ASC']] });
    const managerNamesById = await resolveManagerNames(rows);
    return rows.map((row) => toRecord(row, managerNamesById));
  });
}

export async function listActiveDepartments(): Promise<DepartmentRecord[]> {
  const records = await listDepartments();
  return records.filter((d) => d.status === 'active');
}

export async function findDepartmentById(id: string): Promise<DepartmentRecord | undefined> {
  if (!isUuid(id)) return undefined;
  return (await listDepartments()).find((d) => d.id === id);
}

export interface DepartmentInput {
  name: string;
  description?: string;
}

export async function createDepartment(input: DepartmentInput, createdBy: string): Promise<DepartmentRecord> {
  await ensureSeeded();
  const creator = await db.User.findOne({ where: { username: createdBy } as never });

  // The unique index on `name` isn't partial (doesn't exclude soft-deleted
  // rows), so a name matching a previously-deleted department would hit a
  // raw Postgres unique-violation on create — restore that row instead
  // (safe: deleteDepartment only ever soft-deletes a department with zero
  // assigned users, so there's nothing to reconcile) rather than leaving the
  // admin stuck unable to reuse a name they can no longer even see.
  const deletedMatch = await db.Department.findOne({
    where: sqlWhere(fn('lower', col('name')), input.name.toLowerCase()) as never,
    paranoid: false
  });
  if (deletedMatch && (deletedMatch.get({ plain: true }) as Record<string, unknown>).deletedAt) {
    await deletedMatch.restore();
    const maxOrder = ((await db.Department.max('order')) as number) || 0;
    await deletedMatch.update({
      name: input.name,
      description: input.description || '',
      order: maxOrder + 1,
      status: 'active',
      updatedBy: creator ? creator.get('id') : null
    } as never);
    invalidateCache(DEPARTMENTS_CACHE_KEY);
    return (await findDepartmentById(deletedMatch.get('id') as string)) as DepartmentRecord;
  }

  const maxOrder = ((await db.Department.max('order')) as number) || 0;
  const row = await db.Department.create({
    name: input.name,
    description: input.description || '',
    order: maxOrder + 1,
    status: 'active',
    createdBy: creator ? creator.get('id') : null,
    updatedBy: creator ? creator.get('id') : null
  } as never);
  invalidateCache(DEPARTMENTS_CACHE_KEY);
  return (await findDepartmentById(row.get('id') as string)) as DepartmentRecord;
}

export interface DepartmentUpdateInput {
  name?: string;
  description?: string;
  status?: DepartmentRecord['status'];
  managerIds?: string[];
}

export async function updateDepartment(id: string, patch: DepartmentUpdateInput, updatedBy: string): Promise<DepartmentRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Department.findByPk(id);
  if (!row) return null;
  const updater = await db.User.findOne({ where: { username: updatedBy } as never });
  const attrs: Record<string, unknown> = { name: patch.name, description: patch.description, status: patch.status, updatedBy: updater ? updater.get('id') : null };
  if (patch.managerIds) attrs.managerIds = patch.managerIds;
  await row.update(attrs as never);
  invalidateCache(DEPARTMENTS_CACHE_KEY);
  return (await findDepartmentById(id)) ?? null;
}

// Grants demo-schedule queue visibility to a real domain manager (see
// isDepartmentManagerRouting section 5/6 of the plan) independent of their
// login role — a manager relationship on a department is sufficient on its
// own, not gated behind being 'manager'/'technical'/'backoffice' role.
export async function isUserADepartmentManager(username: string): Promise<boolean> {
  const user = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
  if (!user) return false;
  const userId = user.get('id') as string;
  const departments = await listActiveDepartments();
  return departments.some((d) => d.managerIds.includes(userId));
}

// All active departments this user manages, resolved to {id, name} — used
// to match a demo's assigned-person department against the viewer's own
// managed department(s) for Dashboard "awaiting your approval" visibility.
export async function departmentsManagedBy(username: string): Promise<{ id: string; name: string }[]> {
  const user = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
  if (!user) return [];
  const userId = user.get('id') as string;
  const departments = await listActiveDepartments();
  return departments.filter((d) => d.managerIds.includes(userId)).map((d) => ({ id: d.id, name: d.name }));
}

// {departmentName -> [{id, username, name}]} for every active department
// with at least one manager — feeds domain-manager routing hints and the
// Dashboard's "awaiting your approval" matching, both client-side.
export async function listDepartmentManagers(): Promise<Record<string, { id: string; username: string; name: string }[]>> {
  const departments = await listActiveDepartments();
  const allIds = new Set<string>();
  departments.forEach((d) => d.managerIds.forEach((id) => allIds.add(id)));
  const users = allIds.size ? await db.User.findAll({ where: { id: [...allIds] } as never, attributes: ['id', 'username', 'name'] }) : [];
  const userById = new Map(users.map((u) => [u.get('id') as string, { id: u.get('id') as string, username: u.get('username') as string, name: u.get('name') as string }]));
  const result: Record<string, { id: string; username: string; name: string }[]> = {};
  departments.forEach((d) => {
    const managers = d.managerIds.map((id) => userById.get(id)).filter((m): m is { id: string; username: string; name: string } => !!m);
    if (managers.length) result[d.name] = managers;
  });
  return result;
}

// Several flows (reimbursement + travel-schedule HR review, HR module
// access) need to resolve "the HR department" specifically, but department
// names are admin-configurable free text (see Department Master) — an exact
// `allManagers['HR']` lookup silently returns nothing the moment someone
// renames it to e.g. "HR & Admin" (confirmed: that's this instance's actual
// current name). Match by a leading "HR" word instead of an exact literal so
// a reasonable rename doesn't quietly break every HR notification.
export function findHrManagers(allManagers: Record<string, { id: string; username: string; name: string }[]>): { id: string; username: string; name: string }[] {
  const hrKey = Object.keys(allManagers).find((k) => /^hr\b/i.test(k.trim()));
  return hrKey ? allManagers[hrKey] : [];
}

export function isHrDepartmentName(name: string): boolean {
  return /^hr\b/i.test(name.trim());
}

export async function reorderDepartments(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => db.Department.update({ order: i + 1 } as never, { where: { id } as never })));
  invalidateCache(DEPARTMENTS_CACHE_KEY);
}

// A department in use by at least one user can't be deleted (would leave
// user records pointing at a department that no longer exists) — deactivate
// it instead so it drops out of new-user dropdowns without breaking history.
export async function isDepartmentInUse(name: string): Promise<boolean> {
  const count = await db.User.count({ where: { department: name } as never });
  return count > 0;
}

export async function deleteDepartment(id: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isUuid(id)) return { ok: false, reason: 'Department not found' };
  const row = await db.Department.findByPk(id);
  if (!row) return { ok: false, reason: 'Department not found' };
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  if (await isDepartmentInUse(plain.name as string)) {
    return { ok: false, reason: 'Department is assigned to one or more users — deactivate it instead' };
  }
  await row.destroy();
  invalidateCache(DEPARTMENTS_CACHE_KEY);
  return { ok: true };
}
