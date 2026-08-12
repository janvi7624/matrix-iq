import { Model } from 'sequelize';
import { NotificationRecord } from './types';
import { db } from './db';

// In-app only, adopting the Notification table that already existed but was
// never wired up anywhere (no store/API/UI referenced it). There is no
// SMTP/messaging integration in this app — this never sends email or SMS.

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): NotificationRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    created_at: isoOrEmpty(plain.createdAt),
    title: (plain.title as string) ?? '',
    body: (plain.body as string) ?? '',
    type: (plain.type as string) ?? '',
    entity_type: (plain.entityType as string) ?? '',
    entity_id: (plain.entityId as string) ?? '',
    is_read: Boolean(plain.isRead)
  };
}

interface NotifyInput {
  title: string;
  body: string;
  type: string;
  entityType: string;
  entityId: string;
}

// Fire-and-forget, same convention as logAudit — a notification failing to
// write must never block the actual workflow action that triggered it.
// Silently drops usernames that don't resolve to a real user and dedupes so
// one person isn't notified twice (e.g. owner === assignee).
export async function notifyUsers(usernames: string[], input: NotifyInput): Promise<void> {
  try {
    const unique = Array.from(new Set(usernames.filter(Boolean)));
    if (!unique.length) return;
    const users = await db.User.findAll({ where: { username: unique } as never });
    if (!users.length) return;
    await db.Notification.bulkCreate(
      users.map((u) => ({
        userId: u.get('id'),
        title: input.title,
        body: input.body,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        isRead: false
      })) as never
    );
  } catch {
    // never block the caller's real action over a notification failure
  }
}

export async function listForUser(username: string, limit = 30): Promise<NotificationRecord[]> {
  const user = await db.User.findOne({ where: { username } as never });
  if (!user) return [];
  const rows = await db.Notification.findAll({ where: { userId: user.get('id') } as never, order: [['createdAt', 'DESC']], limit });
  return rows.map(toRecord);
}

export async function unreadCount(username: string): Promise<number> {
  const user = await db.User.findOne({ where: { username } as never });
  if (!user) return 0;
  return db.Notification.count({ where: { userId: user.get('id'), isRead: false } as never });
}

// Scoped to the owning user so one account can never mark another's
// notifications read.
export async function markRead(id: string, username: string): Promise<boolean> {
  const user = await db.User.findOne({ where: { username } as never });
  if (!user) return false;
  const [count] = await db.Notification.update({ isRead: true } as never, { where: { id, userId: user.get('id') } as never });
  return count > 0;
}

export async function markAllRead(username: string): Promise<void> {
  const user = await db.User.findOne({ where: { username } as never });
  if (!user) return;
  await db.Notification.update({ isRead: true } as never, { where: { userId: user.get('id'), isRead: false } as never });
}
