import { Model } from 'sequelize';
import { DepartmentRecord } from './types';
import { db, isUuid } from './db';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

// First-run seed only — from here on, Super Admin manages departments entirely
// from /admin/departments. No department name is hardcoded anywhere else in
// the app; the User form's Department field reads from this list.
const SEED_NAMES = ['Sales', 'Technical', 'Back Office', 'Accounts', 'HR', 'Purchase', 'Inventory', 'Marketing', 'Management', 'Administration'];

async function ensureSeeded(): Promise<void> {
  const count = await db.Department.count();
  if (count > 0) return;
  await db.Department.bulkCreate(SEED_NAMES.map((name, i) => ({ name, description: '', order: i + 1, status: 'active' })) as never);
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const updaterInclude = { model: db.User, as: 'updater', attributes: ['id', 'username'] };

function toRecord(row: Model): DepartmentRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    name: plain.name as string,
    description: (plain.description as string) ?? '',
    order: plain.order as number,
    status: plain.status as DepartmentRecord['status'],
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    updated_by: (plain.updater as { username?: string } | null)?.username ?? ''
  };
}

export async function listDepartments(): Promise<DepartmentRecord[]> {
  await ensureSeeded();
  const rows = await db.Department.findAll({ include: [creatorInclude, updaterInclude], order: [['order', 'ASC']] });
  return rows.map(toRecord);
}

export async function listActiveDepartments(): Promise<DepartmentRecord[]> {
  const records = await listDepartments();
  return records.filter((d) => d.status === 'active');
}

export async function findDepartmentById(id: string): Promise<DepartmentRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Department.findByPk(id, { include: [creatorInclude, updaterInclude] });
  return row ? toRecord(row) : undefined;
}

export interface DepartmentInput {
  name: string;
  description?: string;
}

export async function createDepartment(input: DepartmentInput, createdBy: string): Promise<DepartmentRecord> {
  await ensureSeeded();
  const maxOrder = ((await db.Department.max('order')) as number) || 0;
  const creator = await db.User.findOne({ where: { username: createdBy } as never });
  const row = await db.Department.create({
    name: input.name,
    description: input.description || '',
    order: maxOrder + 1,
    status: 'active',
    createdBy: creator ? creator.get('id') : null,
    updatedBy: creator ? creator.get('id') : null
  } as never);
  return (await findDepartmentById(row.get('id') as string)) as DepartmentRecord;
}

export interface DepartmentUpdateInput {
  name?: string;
  description?: string;
  status?: DepartmentRecord['status'];
}

export async function updateDepartment(id: string, patch: DepartmentUpdateInput, updatedBy: string): Promise<DepartmentRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Department.findByPk(id);
  if (!row) return null;
  const updater = await db.User.findOne({ where: { username: updatedBy } as never });
  await row.update({ name: patch.name, description: patch.description, status: patch.status, updatedBy: updater ? updater.get('id') : null } as never);
  return (await findDepartmentById(id)) ?? null;
}

export async function reorderDepartments(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => db.Department.update({ order: i + 1 } as never, { where: { id } as never })));
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
  return { ok: true };
}
