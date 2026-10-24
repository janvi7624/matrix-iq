import { Model, Op } from 'sequelize';
import { db, isUuid } from './db';
import { createUser, updateUser } from './userStore';
import { generateTempPassword } from './passwords';
import { PARTNER_ROLE_KEYS, PartnerRoleKey } from './partnerRoles';
import { setPartnerStatus } from './partnerStore';

// Partner login accounts.
//
// These are ordinary `users` rows carrying partnerId — deliberately NOT a
// separate table. Everything an account needs already exists here and is
// already hardened: username uniqueness, password hashing, the SES welcome
// email, login history, and the mustChangePassword lock that proxy.ts uses
// to pin an account to /change-password until it sets its own password.
//
// That last one is why the Partner Portal needs no invitation-token table of
// its own: "create the account, email a one-time password, force a change on
// first login" is an activation flow this app already implements and already
// tests. A parallel token system would have been a second way to do the same
// thing, with its own expiry and replay bugs to find.

export interface PartnerUserRecord {
  id: string;
  username: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string;
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): PartnerUserRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    username: (plain.username as string) ?? '',
    name: (plain.name as string) ?? '',
    email: (plain.email as string) ?? '',
    phone: (plain.phone as string) ?? '',
    role: (plain.role as { key?: string } | null)?.key ?? '',
    status: (plain.status as string) ?? '',
    mustChangePassword: Boolean(plain.mustChangePassword),
    lastLoginAt: isoOrEmpty(plain.lastLoginAt)
  };
}

export async function listPartnerUsers(partnerId: string): Promise<PartnerUserRecord[]> {
  if (!isUuid(partnerId)) return [];
  const rows = await db.User.findAll({
    // partnerId in the WHERE, never a post-filter — the rule every
    // partner-scoped query in this feature follows.
    where: { partnerId } as never,
    include: [{ model: db.Role, as: 'role', attributes: ['key'] }],
    order: [['createdAt', 'ASC']]
  });
  return rows.map(toRecord);
}

/**
 * Every partner login's user id.
 *
 * Exists so internal people-pickers can exclude external accounts. Without
 * it, partner logins surface in every "User Selector" in the app — custom
 * module person fields, assignment dropdowns, department manager pickers —
 * since those read the generic active-user list and have no idea the concept
 * of an external account exists. An external contact must never be
 * assignable as an internal owner of internal work.
 *
 * Same spirit as canViewRole's superadmin invisibility in lib/permissions.ts:
 * filtered out of the pickers, not merely blocked after selection.
 */
export async function listPartnerUserIds(): Promise<Set<string>> {
  const rows = await db.User.findAll({
    where: { partnerId: { [Op.ne]: null } } as never,
    attributes: ['id']
  });
  return new Set(rows.map((r) => r.get('id') as string));
}

export interface CreatePartnerUserInput {
  partnerId: string;
  username: string;
  name: string;
  email: string;
  phone?: string;
  role: PartnerRoleKey;
}

export class PartnerUserError extends Error {}

/**
 * Issue a login for a partner company.
 *
 * Returns the temporary password so the caller can show it once — the same
 * contract the bulk employee import already uses (lib/userImportStore.ts).
 * It is also emailed by createUser; surfacing it here covers the real case
 * where SES is unconfigured or the partner's mail bounces, which would
 * otherwise leave an account nobody can get into.
 */
export async function createPartnerUser(
  input: CreatePartnerUserInput,
  createdByUserId: string
): Promise<{ user: { id: string; username: string; name: string; email: string }; tempPassword: string }> {
  if (!isUuid(input.partnerId)) throw new PartnerUserError('Unknown partner');
  if (!(PARTNER_ROLE_KEYS as readonly string[]).includes(input.role)) {
    // Guards the one mistake that would breach the whole isolation model:
    // an account bound to a partner but holding an INTERNAL role. proxy.ts
    // and getViewerContext both key off partnerId, so such an account would
    // still be confined to the portal — but its role would leak into every
    // role-based branch in the app, and Role Management would show a partner
    // sitting in a staff role. Refuse it at the only place that creates them.
    throw new PartnerUserError('A partner login must hold a partner role');
  }

  const tempPassword = generateTempPassword();
  const created = await createUser({
    username: input.username,
    password: tempPassword,
    name: input.name,
    phone: input.phone || '',
    email: input.email,
    role: input.role,
    partnerId: input.partnerId,
    // Forces the password change on first login — see the module comment.
    mustChangePassword: true
  });

  // A partner with a working login is a live relationship, so the company
  // leaves 'pending' the moment its first account exists. Idempotent: the
  // transition rules treat active -> active as a no-op.
  await setPartnerStatus(input.partnerId, 'active', createdByUserId).catch(() => undefined);

  return {
    user: { id: created.id, username: created.username, name: created.name, email: created.email },
    tempPassword
  };
}

/**
 * Suspend or restore one partner login, or reset its password.
 *
 * Scoped by partnerId as well as user id so a caller holding only a user id
 * cannot reach an account belonging to a different partner — or, worse, an
 * internal employee's account — through this route.
 */
export async function updatePartnerUser(
  partnerId: string,
  userId: string,
  patch: { status?: 'active' | 'inactive'; resetPassword?: boolean }
): Promise<{ record: PartnerUserRecord; tempPassword?: string } | undefined> {
  if (!isUuid(partnerId) || !isUuid(userId)) return undefined;
  const row = await db.User.findOne({ where: { id: userId, partnerId } as never });
  if (!row) return undefined;

  let tempPassword: string | undefined;
  const changes: Parameters<typeof updateUser>[1] = {};
  if (patch.status) changes.status = patch.status;
  if (patch.resetPassword) {
    tempPassword = generateTempPassword();
    changes.password = tempPassword;
    changes.mustChangePassword = true;
    // 'admin' so the password-changed email actually carries the new
    // password — the partner did not type it and has no other way to learn
    // it. See the UpdateUserInput comment in lib/userStore.ts.
    changes.passwordChangeInitiatedBy = 'admin';
  }
  await updateUser(userId, changes);

  const fresh = await db.User.findByPk(userId, { include: [{ model: db.Role, as: 'role', attributes: ['key'] }] });
  return { record: toRecord(fresh as Model), tempPassword };
}
