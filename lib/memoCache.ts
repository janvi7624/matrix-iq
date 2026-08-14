// Tiny in-process TTL cache for read-heavy, rarely-written reference data
// (roles, departments, module config, app settings) — safe here specifically
// because this app runs as a single persistent Node process (output:
// 'standalone' on Hostinger, see next.config.ts), not serverless functions,
// so a module-level Map genuinely persists across requests instead of being
// pointless per-invocation state. Never use this for anything security- or
// workflow-state-sensitive (a user's active/inactive status, approval
// status, permissions computed per-request) — only for slow-changing
// lookup tables that already go through an explicit invalidate() on every
// write path, so staleness is bounded by both the TTL and the write path,
// not just the TTL alone.
const store = new Map<string, { value: unknown; expiresAt: number }>();

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await loader();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidateCache(key: string): void {
  store.delete(key);
}
