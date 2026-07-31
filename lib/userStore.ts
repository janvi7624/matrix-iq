import { PublicUser, UserRecord, UserRole } from './types';
import { hashPassword, verifyPassword } from './passwords';
import { readJsonBlob, writeJsonBlob } from './blobStore';

const DATA_PATHNAME = 'data/users.json';

async function readUsersRaw(): Promise<UserRecord[]> {
  return readJsonBlob<UserRecord[]>(DATA_PATHNAME, []);
}

async function writeUsersRaw(users: UserRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, users);
}

// One-time bootstrap: if no users exist yet, seed a single superadmin account
// from ADMIN_USERNAME / ADMIN_PASSWORD so there's always a way in. Once any
// user exists, accounts are managed entirely through the /admin/users UI.
async function ensureSeedAdmin(users: UserRecord[]): Promise<UserRecord[]> {
  if (users.length > 0) return users;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return users;

  const passwordHash = await hashPassword(password);
  const seeded: UserRecord = {
    id: `${Date.now()}`,
    username,
    passwordHash,
    name: 'Admin',
    phone: '',
    email: `${username}@nantatech.com`,
    role: 'superadmin',
    employeeId: '',
    department: '',
    designation: '',
    status: 'active',
    createdAt: new Date().toISOString(),
    lastLoginAt: ''
  };
  const next = [seeded];
  await writeUsersRaw(next);
  return next;
}

// Records written before employeeId/department/designation/status/lastLoginAt
// existed won't have them in blob storage — fill in safe defaults on read so
// older accounts don't get silently treated as inactive (status is undefined,
// not 'active') or crash on missing fields.
function normalizeUser(user: UserRecord): UserRecord {
  return {
    ...user,
    employeeId: user.employeeId ?? '',
    department: user.department ?? '',
    designation: user.designation ?? '',
    status: user.status ?? 'active',
    lastLoginAt: user.lastLoginAt ?? ''
  };
}

async function readUsers(): Promise<UserRecord[]> {
  const users = await ensureSeedAdmin(await readUsersRaw());
  return users.map(normalizeUser);
}

function toPublicUser(user: UserRecord): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  void _passwordHash;
  return rest;
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await readUsers();
  return users.map(toPublicUser).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  const users = await readUsers();
  return users.find((u) => u.id === id);
}

export async function findUserByUsername(username: string): Promise<UserRecord | undefined> {
  const users = await readUsers();
  return users.find((u) => u.username.toLowerCase() === username.toLowerCase());
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
  const users = await readUsers();
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return;
  users[index] = { ...users[index], lastLoginAt: new Date().toISOString() };
  await writeUsersRaw(users);
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
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  const users = await readUsers();
  if (users.some((u) => u.username.toLowerCase() === input.username.toLowerCase())) {
    throw new Error('Username already exists');
  }
  const passwordHash = await hashPassword(input.password);
  const record: UserRecord = {
    id: `${Date.now()}`,
    username: input.username,
    passwordHash,
    name: input.name,
    phone: input.phone,
    email: input.email,
    role: input.role,
    employeeId: input.employeeId || '',
    department: input.department || '',
    designation: input.designation || '',
    status: 'active',
    createdAt: new Date().toISOString(),
    lastLoginAt: ''
  };
  users.push(record);
  await writeUsersRaw(users);
  return toPublicUser(record);
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
  status?: UserRecord['status'];
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<PublicUser | null> {
  const users = await readUsers();
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return null;

  const current = users[index];
  const updated: UserRecord = {
    ...current,
    name: patch.name ?? current.name,
    phone: patch.phone ?? current.phone,
    email: patch.email ?? current.email,
    role: patch.role ?? current.role,
    employeeId: patch.employeeId ?? current.employeeId,
    department: patch.department ?? current.department,
    designation: patch.designation ?? current.designation,
    status: patch.status ?? current.status,
    passwordHash: patch.password ? await hashPassword(patch.password) : current.passwordHash
  };
  users[index] = updated;
  await writeUsersRaw(users);
  return toPublicUser(updated);
}

export async function deleteUser(id: string): Promise<boolean> {
  const users = await readUsers();
  const next = users.filter((u) => u.id !== id);
  if (next.length === users.length) return false;
  await writeUsersRaw(next);
  return true;
}

export async function countSuperAdmins(): Promise<number> {
  const users = await readUsers();
  return users.filter((u) => u.role === 'superadmin').length;
}
