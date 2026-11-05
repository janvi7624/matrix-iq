import { Op } from 'sequelize';
import { LoginHistoryEntry } from './types';
import { db } from './db';

// Keep the log from growing forever — this is a UI convenience (recent login
// activity), not a compliance audit trail like lib/auditLogStore.ts.
const MAX_ENTRIES = 2000;

export async function logLoginAttempt(input: { username: string; success: boolean; ip: string }): Promise<void> {
  try {
    const user = await db.User.findOne({ where: { username: input.username } as never });
    await db.LoginHistory.create({ username: input.username, userId: user ? user.get('id') : null, at: new Date(), success: input.success, ip: input.ip } as never);

    const count = await db.LoginHistory.count();
    if (count > MAX_ENTRIES) {
      const overflow = count - MAX_ENTRIES;
      const oldest = await db.LoginHistory.findAll({ attributes: ['id'], order: [['at', 'ASC']], limit: overflow });
      await db.LoginHistory.destroy({ where: { id: oldest.map((r) => r.get('id')) } as never });
    }
  } catch {
    // Best-effort only — a logging failure should never block a real login.
  }
}

// Brute-force guard, found missing in an attack pass (20 rapid wrong
// passwords against one account, zero throttling). Built on this table
// rather than a new column/counter on the user — every login attempt is
// already logged here, so no schema change is needed.
//
// Locked out once the most recent LOCKOUT_THRESHOLD attempts within
// LOCKOUT_WINDOW_MS are ALL failures — walking back from "now", the streak
// breaks (and the account is immediately usable again) the instant a real
// success appears, so a legitimate user who mistypes their password a
// couple of times and then gets it right is never locked out.
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_THRESHOLD = 8;

export async function isLoginLocked(username: string): Promise<boolean> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const rows = await db.LoginHistory.findAll({
    where: { username: { [Op.iLike]: username }, at: { [Op.gte]: since } } as never,
    order: [['at', 'DESC']],
    limit: LOCKOUT_THRESHOLD,
    attributes: ['success']
  });
  if (rows.length < LOCKOUT_THRESHOLD) return false;
  return rows.every((row) => row.get('success') === false);
}

export async function listLoginHistory(username?: string, limit = 50): Promise<LoginHistoryEntry[]> {
  const where: Record<string, unknown> = {};
  if (username) where.username = { [Op.iLike]: username };
  const rows = await db.LoginHistory.findAll({ where: where as never, order: [['at', 'DESC']], limit });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const at = plain.at;
    return {
      id: plain.id as string,
      username: (plain.username as string) ?? '',
      at: at instanceof Date ? at.toISOString() : String(at ?? ''),
      success: plain.success as boolean,
      ip: (plain.ip as string) ?? ''
    };
  });
}
