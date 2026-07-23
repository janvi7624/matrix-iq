import fs from 'fs';
import path from 'path';
import { PublicUser, UserRecord, UserRole } from './types';
import { hashPassword, verifyPassword } from './passwords';

const DATA_FILE = path.join(process.cwd(), 'data', 'users.json');

function ensureDataFile(): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]\n', 'utf-8');
}

function readUsersRaw(): UserRecord[] {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsersRaw(users: UserRecord[]): void {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2) + '\n', 'utf-8');
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
    createdAt: new Date().toISOString()
  };
  const next = [seeded];
  writeUsersRaw(next);
  return next;
}

async function readUsers(): Promise<UserRecord[]> {
  return ensureSeedAdmin(readUsersRaw());
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

export async function verifyLogin(username: string, password: string): Promise<UserRecord | null> {
  const user = await findUserByUsername(username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
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
    createdAt: new Date().toISOString()
  };
  users.push(record);
  writeUsersRaw(users);
  return toPublicUser(record);
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
  email?: string;
  role?: UserRole;
  password?: string;
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
    passwordHash: patch.password ? await hashPassword(patch.password) : current.passwordHash
  };
  users[index] = updated;
  writeUsersRaw(users);
  return toPublicUser(updated);
}

export async function deleteUser(id: string): Promise<boolean> {
  const users = await readUsers();
  const next = users.filter((u) => u.id !== id);
  if (next.length === users.length) return false;
  writeUsersRaw(next);
  return true;
}

export async function countSuperAdmins(): Promise<number> {
  const users = await readUsers();
  return users.filter((u) => u.role === 'superadmin').length;
}
