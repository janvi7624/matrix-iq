import { db } from './db';
import { MetaAssignmentMode, MetaCampaignRoute, MetaIntegrationConfigRecord } from './types';

// Singleton — always exactly one row, same pattern as lib/appConfigStore.ts.
// Deliberately NOT run through lib/memoCache.ts's cached() helper: that
// cache exists for hot, read-heavy tables (AppConfig is read on nearly
// every quotation/PDF calculation). This table is read at most once per
// admin page load and once per incoming Meta lead — traffic low enough
// that a 30s-stale read (e.g. the round-robin cursor, or a default owner
// an admin just changed) isn't worth risking for the perf gain.
function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const includes = [
  { model: db.Department, as: 'defaultDepartment', attributes: ['id', 'name'] },
  { model: db.User, as: 'defaultOwner', attributes: ['id', 'username'] },
  { model: db.User, as: 'updatedBy', attributes: ['id', 'username'] }
];

function toRecord(row: import('sequelize').Model): MetaIntegrationConfigRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    webhookVerified: Boolean(plain.webhook_verified),
    lastConnectionTestAt: isoOrEmpty(plain.last_connection_test_at),
    lastConnectionTestOk: plain.last_connection_test_ok === null || plain.last_connection_test_ok === undefined ? null : Boolean(plain.last_connection_test_ok),
    lastConnectionTestMessage: (plain.last_connection_test_message as string) ?? '',
    lastWebhookReceivedAt: isoOrEmpty(plain.last_webhook_received_at),
    lastSuccessfulSyncAt: isoOrEmpty(plain.last_successful_sync_at),
    assignmentMode: (plain.assignment_mode as MetaAssignmentMode) ?? 'fixed',
    defaultDepartmentId: (plain.default_department_id as string) ?? '',
    defaultOwnerId: (plain.default_owner_id as string) ?? '',
    defaultOwnerUsername: (plain.defaultOwner as { username?: string } | null)?.username ?? '',
    roundRobinPool: (plain.round_robin_pool as string[]) ?? [],
    roundRobinCursor: Number(plain.round_robin_cursor ?? 0),
    campaignRoutingMap: (plain.campaign_routing_map as Record<string, MetaCampaignRoute>) ?? {},
    updatedAt: isoOrEmpty(plain.updated_at),
    updatedByUsername: (plain.updatedBy as { username?: string } | null)?.username ?? ''
  };
}

async function getOrCreateRow() {
  const existing = await db.MetaIntegrationConfig.findOne({ include: includes });
  if (existing) return existing;
  const row = await db.MetaIntegrationConfig.create({} as never);
  return (await db.MetaIntegrationConfig.findByPk(row.get('id') as string, { include: includes })) as NonNullable<typeof row>;
}

export async function getMetaIntegrationConfig(): Promise<MetaIntegrationConfigRecord> {
  return toRecord(await getOrCreateRow());
}

const VALID_MODES: MetaAssignmentMode[] = ['fixed', 'round_robin', 'campaign'];

export interface MetaIntegrationConfigPatch {
  assignmentMode?: MetaAssignmentMode;
  defaultDepartmentId?: string;
  defaultOwnerId?: string;
  roundRobinPool?: string[];
  campaignRoutingMap?: Record<string, MetaCampaignRoute>;
}

// Admin-editable fields only — webhook_verified / last_* / round_robin_cursor
// are never accepted from this path, they're only ever written by the
// dedicated touch*/markWebhookVerified/resolveNextRoundRobinOwnerId
// functions below, driven by real webhook/sync/test-connection events.
export async function updateMetaIntegrationConfig(patch: MetaIntegrationConfigPatch, updatedByUsername: string): Promise<MetaIntegrationConfigRecord> {
  const row = await getOrCreateRow();
  const updater = await db.User.findOne({ where: { username: updatedByUsername } as never });
  const attrs: Record<string, unknown> = { updated_at: new Date(), updated_by_id: updater ? updater.get('id') : null };
  if (patch.assignmentMode && VALID_MODES.includes(patch.assignmentMode)) attrs.assignment_mode = patch.assignmentMode;
  if (patch.defaultDepartmentId !== undefined) attrs.default_department_id = patch.defaultDepartmentId || null;
  if (patch.defaultOwnerId !== undefined) attrs.default_owner_id = patch.defaultOwnerId || null;
  if (Array.isArray(patch.roundRobinPool)) attrs.round_robin_pool = patch.roundRobinPool;
  if (patch.campaignRoutingMap && typeof patch.campaignRoutingMap === 'object') attrs.campaign_routing_map = patch.campaignRoutingMap;
  await row.update(attrs);
  return getMetaIntegrationConfig();
}

export async function markWebhookVerified(): Promise<void> {
  const row = await getOrCreateRow();
  await row.update({ webhook_verified: true });
}

export async function touchWebhookReceived(): Promise<void> {
  const row = await getOrCreateRow();
  await row.update({ last_webhook_received_at: new Date() });
}

export async function touchConnectionTest(ok: boolean, message: string): Promise<void> {
  const row = await getOrCreateRow();
  await row.update({ last_connection_test_at: new Date(), last_connection_test_ok: ok, last_connection_test_message: message });
}

export async function touchSuccessfulSync(): Promise<void> {
  const row = await getOrCreateRow();
  await row.update({ last_successful_sync_at: new Date() });
}

// Advances the round-robin cursor and returns the user id that should own
// the next Meta lead. Always a fresh read-then-write (no cache) — under
// truly concurrent webhook delivery this can still race (two leads reading
// the same cursor value before either writes it back), which would mean
// two leads land on the same person instead of alternating; that's a soft
// fairness miss, not a correctness bug (unlike leads.meta_lead_id's unique
// index, which guarantees no duplicate lead is ever created). A stricter
// guarantee would need a DB-level atomic increment (e.g. a raw UPDATE ...
// RETURNING), which isn't worth the added complexity at this traffic volume.
export async function resolveNextRoundRobinOwnerId(pool: string[]): Promise<string | null> {
  if (!pool.length) return null;
  const row = await getOrCreateRow();
  const cursor = Number(row.get('round_robin_cursor') ?? 0);
  const index = ((cursor % pool.length) + pool.length) % pool.length;
  await row.update({ round_robin_cursor: cursor + 1 });
  return pool[index];
}
