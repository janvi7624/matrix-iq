import { db } from './db';
import { listUsers } from './userStore';
import { notifyUsers } from './notificationStore';
import { sendFestivalEmail } from './email/notifications';

// Company-wide Indian festival greetings. HR-managed (see db/migrations/
// 20261109143000-create-festivals.js for the full rationale) — previously a
// hardcoded array in lib/festivalCalendar.ts (now removed), now a `festivals`
// table HR can add/edit/delete from /hr/festivals.
//
// Same trigger model as lib/celebrationStore.ts's birthdays/anniversaries:
// no cron exists anywhere in this app; the first logged-in user's dashboard
// load each day is what fires it. But a festival is a single SHARED
// calendar event, not a per-user one, so there's no "celebrant" and no
// personal/announcement split — everyone gets the same greeting, once, on
// the day.

export interface FestivalRecord {
  id: string;
  key: string;
  name: string;
  date: string; // 'YYYY-MM-DD'
  greeting: string;
  provisional: boolean;
  created_at: string;
  updated_at: string;
}

function toRecord(row: InstanceType<typeof db.Festival>): FestivalRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    key: plain.key as string,
    name: plain.name as string,
    date: plain.date as string,
    greeting: plain.greeting as string,
    provisional: Boolean(plain.provisional),
    created_at: (plain.createdAt as Date)?.toISOString?.() ?? '',
    updated_at: (plain.updatedAt as Date)?.toISOString?.() ?? ''
  };
}

/** Every festival, soonest first — the HR management screen's own list. */
export async function listFestivals(): Promise<FestivalRecord[]> {
  const rows = await db.Festival.findAll({ order: [['date', 'ASC']] });
  return rows.map(toRecord);
}

export async function findFestivalById(id: string): Promise<FestivalRecord | undefined> {
  const row = await db.Festival.findByPk(id);
  return row ? toRecord(row) : undefined;
}

export interface FestivalInput {
  key: string;
  name: string;
  date: string;
  greeting: string;
  provisional?: boolean;
}

// Plain create() — deliberately NOT findOrCreate(), which fails at runtime
// on this app's DB role (no CREATE TEMP privilege; see lib/salesTargetStore.ts's
// upsertSalesTargets for the same constraint elsewhere). The unique index on
// `key` (the migration's festivals_key_unique) is the duplicate guard; a
// genuine duplicate surfaces as a clean SequelizeUniqueConstraintError the
// route below turns into a 409, not a crash.
export async function createFestival(input: FestivalInput, actorId: string): Promise<FestivalRecord> {
  const row = await db.Festival.create({
    key: input.key.trim(),
    name: input.name.trim(),
    date: input.date,
    greeting: input.greeting.trim(),
    provisional: input.provisional ?? false,
    created_by: actorId,
    updated_by: actorId
  } as never);
  return toRecord(row);
}

export async function updateFestival(id: string, input: Partial<FestivalInput>, actorId: string): Promise<FestivalRecord | null> {
  const row = await db.Festival.findByPk(id);
  if (!row) return null;
  const patch: Record<string, unknown> = { updated_by: actorId };
  if (input.key !== undefined) patch.key = input.key.trim();
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.date !== undefined) patch.date = input.date;
  if (input.greeting !== undefined) patch.greeting = input.greeting.trim();
  if (input.provisional !== undefined) patch.provisional = input.provisional;
  await row.update(patch as never);
  return toRecord(row);
}

export async function deleteFestival(id: string): Promise<boolean> {
  const row = await db.Festival.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

/** Today's festival, if any — IST calendar day, matching the rest of this app's date conventions (see lib/dailyReportTime.ts). */
export async function getTodaysFestival(referenceDate: Date = new Date()): Promise<FestivalRecord | null> {
  const istDateOnly = new Date(referenceDate.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const row = await db.Festival.findOne({ where: { date: istDateOnly } as never });
  return row ? toRecord(row) : null;
}

/**
 * Dedup marker: ANY Notification of today's festival's marker type means
 * the emails for TODAY'S festival have already gone out — checked once
 * globally (not per-user, since this is a company-wide broadcast). Mirrors
 * lib/celebrationStore.ts's alreadyNotifiedToday, scoped to "has anyone
 * received today's festival marker yet" instead of "has this one celebrant
 * been processed yet".
 */
async function alreadyNotifiedToday(markerType: string): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };
  const count = await db.Notification.count({ where: { type: markerType, createdAt: { [Op.gte]: startOfDay } } as never });
  return count > 0;
}

/**
 * The actual orchestration: if today is a festival and it hasn't already
 * been sent today, emails every active user the greeting and posts an
 * in-app notification to the whole active roster (which doubles as
 * tomorrow's "already sent" marker for this festival).
 */
export async function processTodaysFestival(): Promise<FestivalRecord | null> {
  const festival = await getTodaysFestival();
  if (!festival) return null;

  const markerType = `festival_${festival.key}`;
  if (await alreadyNotifiedToday(markerType)) return festival;

  const activeUsers = (await listUsers()).filter((u) => u.status === 'active');

  await Promise.allSettled(
    activeUsers
      .filter((u) => u.email)
      .map((u) => sendFestivalEmail({ email: u.email, name: u.name || u.username, festivalName: festival.name, greeting: festival.greeting }))
  );

  await notifyUsers(activeUsers.map((u) => u.username), {
    title: `🎉 ${festival.name}!`,
    body: festival.greeting,
    type: markerType,
    entityType: 'festival',
    entityId: festival.id
  });

  return festival;
}
