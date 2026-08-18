import { Model, fn, col, where as sqlWhere } from 'sequelize';
import { PublicUser, UserRecord, UserRole } from './types';
import { hashPassword, verifyPassword } from './passwords';
import { db, isUuid } from './db';
import { listRoles, findRoleByKey } from './roleStore';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const roleInclude = { model: db.Role, as: 'role', attributes: ['id', 'key'] };
const deptInclude = { model: db.Department, as: 'departmentRef', attributes: ['id', 'name'] };

function toUserRecord(row: Model): UserRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    username: plain.username as string,
    passwordHash: plain.passwordHash as string,
    name: (plain.name as string) ?? '',
    phone: (plain.phone as string) ?? '',
    email: (plain.email as string) ?? '',
    role: (plain.role as { key?: string } | null)?.key ?? '',
    employeeId: (plain.employeeId as string) ?? '',
    department: (plain.departmentRef as { name?: string } | null)?.name ?? (plain.department as string) ?? '',
    designation: (plain.designation as string) ?? '',
    location: (plain.location as string) ?? '',
    status: (plain.status as UserRecord['status']) ?? 'active',
    createdAt: isoOrEmpty(plain.createdAt),
    lastLoginAt: isoOrEmpty(plain.lastLoginAt),
    mustChangePassword: (plain.mustChangePassword as boolean) ?? false
  };
}

function toPublicUser(user: UserRecord): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  void _passwordHash;
  return rest;
}

// One-time bootstrap: if no users exist yet, seed a single superadmin account
// from ADMIN_USERNAME / ADMIN_PASSWORD so there's always a way in. Once any
// user exists, accounts are managed entirely through the /admin/users UI.
async function ensureSeedAdmin(): Promise<void> {
  const count = await db.User.count();
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;

  await listRoles(); // ensures the built-in roles (incl. 'superadmin') exist
  const superadminRole = await findRoleByKey('superadmin');
  if (!superadminRole) return;

  const passwordHash = await hashPassword(password);
  await db.User.create({
    username,
    passwordHash,
    name: 'Admin',
    phone: '',
    email: `${username}@nantatech.com`,
    roleId: superadminRole.id,
    employeeId: '',
    department: '',
    designation: '',
    status: 'active'
  } as never);
}

async function resolveDepartmentId(name: string): Promise<string | null> {
  if (!name) return null;
  const dept = await db.Department.findOne({ where: { name } as never });
  return dept ? (dept.get('id') as string) : null;
}

export async function listUsers(): Promise<PublicUser[]> {
  await ensureSeedAdmin();
  const rows = await db.User.findAll({ include: [roleInclude, deptInclude], order: [['createdAt', 'ASC']] });
  return rows.map((r) => toPublicUser(toUserRecord(r)));
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  // A session cookie issued before the Supabase migration carries an old
  // Date.now()-based id — treat that the same as "no such user" (forces
  // re-login) instead of letting Postgres throw on the malformed UUID.
  if (!isUuid(id)) return undefined;
  const row = await db.User.findByPk(id, { include: [roleInclude, deptInclude] });
  return row ? toUserRecord(row) : undefined;
}

// The per-request "does this account still exist and is it still active"
// check (lib/viewerContext.ts) only ever reads `.status` — findUserById's
// role+department joins are wasted work on what is the single most-called
// user lookup in the app (runs on ~every authenticated request). No joins,
// one column.
export async function findUserStatusById(id: string): Promise<{ id: string; status: string } | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.User.findByPk(id, { attributes: ['id', 'status'] });
  if (!row) return undefined;
  return { id: row.get('id') as string, status: row.get('status') as string };
}

export async function findUserByUsername(username: string): Promise<UserRecord | undefined> {
  await ensureSeedAdmin();
  const row = await db.User.findOne({
    where: sqlWhere(fn('lower', col('username')), username.toLowerCase()) as never,
    include: [roleInclude, deptInclude]
  });
  return row ? toUserRecord(row) : undefined;
}

// Sidebar's profile card (runs on every page) only ever needs name + department
// — it already has `role` from the signed session, so the role join
// findUserByUsername pays for is pure waste here.
export async function findUserNameAndDeptByUsername(username: string): Promise<{ name: string; department: string } | undefined> {
  const row = await db.User.findOne({
    where: sqlWhere(fn('lower', col('username')), username.toLowerCase()) as never,
    include: [deptInclude],
    attributes: ['id', 'name']
  });
  if (!row) return undefined;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return { name: (plain.name as string) ?? '', department: (plain.departmentRef as { name?: string } | null)?.name ?? '' };
}

// Returns null for a wrong password AND for a correct password on an
// inactive account — callers don't need to distinguish (either way, no login).
export async function verifyLogin(username: string, password: string): Promise<UserRecord | null> {
  const user = await findUserByUsername(username);
  if (!user) return null;
  if (user.status === 'inactive') return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

export async function recordLogin(id: string): Promise<void> {
  if (!isUuid(id)) return;
  const row = await db.User.findByPk(id);
  if (!row) return;
  await row.update({ lastLoginAt: new Date() } as never);
}

export interface CreateUserInput {
  username: string;
  password: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  employeeId?: string;
  department?: string;
  designation?: string;
  location?: string;
  mustChangePassword?: boolean;
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  const existing = await db.User.findOne({
    where: sqlWhere(fn('lower', col('username')), input.username.toLowerCase()) as never
  });
  if (existing) throw new Error('Username already exists');

  const role = await db.Role.findOne({ where: { key: input.role } as never });
  if (!role) throw new Error('Unknown role');

  const passwordHash = await hashPassword(input.password);
  const departmentId = await resolveDepartmentId(input.department || '');
  const row = await db.User.create({
    username: input.username,
    passwordHash,
    name: input.name,
    phone: input.phone,
    email: input.email,
    roleId: role.get('id'),
    employeeId: input.employeeId || '',
    department: input.department || '',
    departmentId,
    designation: input.designation || '',
    location: input.location || '',
    status: 'active',
    mustChangePassword: input.mustChangePassword ?? false
  } as never);

  const created = await db.User.findByPk(row.get('id') as string, { include: [roleInclude, deptInclude] });
  return toPublicUser(toUserRecord(created as Model));
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
  email?: string;
  role?: UserRole;
  password?: string;
  employeeId?: string;
  department?: string;
  designation?: string;
  location?: string;
  status?: UserRecord['status'];
  mustChangePassword?: boolean;
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<PublicUser | null> {
  if (!isUuid(id)) return null;
  const row = await db.User.findByPk(id);
  if (!row) return null;

  const attrs: Record<string, unknown> = {
    name: patch.name,
    phone: patch.phone,
    email: patch.email,
    employeeId: patch.employeeId,
    designation: patch.designation,
    location: patch.location,
    status: patch.status
  };
  if (patch.role !== undefined) {
    const role = await db.Role.findOne({ where: { key: patch.role } as never });
    if (!role) throw new Error('Unknown role');
    attrs.roleId = role.get('id');
  }
  if (patch.department !== undefined) {
    attrs.department = patch.department;
    attrs.departmentId = await resolveDepartmentId(patch.department);
  }
  if (patch.password) attrs.passwordHash = await hashPassword(patch.password);
  if (patch.mustChangePassword !== undefined) attrs.mustChangePassword = patch.mustChangePassword;

  await row.update(attrs as never);
  const updated = await db.User.findByPk(id, { include: [roleInclude, deptInclude] });
  return toPublicUser(toUserRecord(updated as Model));
}

export async function deleteUser(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.User.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export async function countSuperAdmins(): Promise<number> {
  const role = await db.Role.findOne({ where: { key: 'superadmin' } as never });
  if (!role) return 0;
  return db.User.count({ where: { roleId: role.get('id') } as never });
}
