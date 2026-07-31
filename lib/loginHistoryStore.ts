import { readJsonBlob, writeJsonBlob } from './blobStore';
import { LoginHistoryEntry } from './types';

const DATA_PATHNAME = 'data/loginHistory.json';
// Keep the log from growing forever — this is a UI convenience (recent login
// activity), not a compliance audit trail like lib/auditLogStore.ts.
const MAX_ENTRIES = 2000;

export async function logLoginAttempt(input: { username: string; success: boolean; ip: string }): Promise<void> {
  try {
    const entries = await readJsonBlob<LoginHistoryEntry[]>(DATA_PATHNAME, []);
    entries.push({
      id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      username: input.username,
      at: new Date().toISOString(),
      success: input.success,
      ip: input.ip
    });
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
    await writeJsonBlob(DATA_PATHNAME, trimmed);
  } catch {
    // Best-effort only — a logging failure should never block a real login.
  }
}

export async function listLoginHistory(username?: string, limit = 50): Promise<LoginHistoryEntry[]> {
  const entries = await readJsonBlob<LoginHistoryEntry[]>(DATA_PATHNAME, []);
  const scoped = username ? entries.filter((e) => e.username.toLowerCase() === username.toLowerCase()) : entries;
  return [...scoped].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
