import { QueryTypes } from 'sequelize';
import { sequelize } from './db';

// Per-user sidebar Quick Actions (table: user_quick_actions, see
// db/migrations/20261114130000-create-user-quick-actions.js).
//
// Raw SQL instead of a Sequelize model so nothing else in the app can load
// this table by accident — and so that, if the code ships before the
// migration has been run, only Quick Actions degrades (empty, cannot save)
// rather than every query that touches the model registry.

export const MAX_QUICK_ACTIONS = 6;

export class QuickActionsUnavailableError extends Error {
  constructor() {
    super('Quick Actions storage is not set up yet');
  }
}

function isMissingTable(error: unknown): boolean {
  const code = (error as { original?: { code?: string }; parent?: { code?: string } })?.original?.code
    ?? (error as { parent?: { code?: string } })?.parent?.code;
  return code === '42P01';
}

/** The user's chosen module keys in order, or [] if they have not chosen any. */
export async function getQuickActionKeys(userId: string): Promise<string[]> {
  try {
    const rows = await sequelize.query<{ module_keys: unknown }>(
      'SELECT module_keys FROM user_quick_actions WHERE user_id = $userId',
      { bind: { userId }, type: QueryTypes.SELECT }
    );
    const keys = rows[0]?.module_keys;
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function setQuickActionKeys(userId: string, keys: string[]): Promise<void> {
  try {
    await sequelize.query(
      `INSERT INTO user_quick_actions (user_id, module_keys, created_at, updated_at)
       VALUES ($userId, $keys::jsonb, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET module_keys = EXCLUDED.module_keys, updated_at = NOW()`,
      { bind: { userId, keys: JSON.stringify(keys) }, type: QueryTypes.INSERT }
    );
  } catch (error) {
    if (isMissingTable(error)) throw new QuickActionsUnavailableError();
    throw error;
  }
}
