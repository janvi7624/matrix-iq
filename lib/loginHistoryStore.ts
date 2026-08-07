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
