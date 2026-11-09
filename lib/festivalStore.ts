import { db } from './db';
import { listUsers } from './userStore';
import { notifyUsers } from './notificationStore';
import { sendFestivalEmail } from './email/notifications';
import { FestivalEntry, getTodaysFestival } from './festivalCalendar';

// Company-wide Indian festival greetings — same trigger model as
// lib/celebrationStore.ts's birthdays/anniversaries (no cron exists
// anywhere in this app; the first logged-in user's dashboard load each day
// is what fires it), but festivals are a single SHARED calendar event, not
// a per-user one, so there's no "celebrant" and no personal/announcement
// split — everyone gets the same greeting, once, on the day.

/**
 * Dedup marker: ANY Notification of today's festival's marker type means
 * the emails for TODAY'S festival have already gone out — checked once
 * globally (not per-user, since this is a company-wide broadcast) by
 * looking for the marker on whichever account is cheapest to probe. Mirrors
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
 * The actual orchestration: if today is a festival (lib/festivalCalendar.ts)
 * and it hasn't already been sent today, emails every active user the
 * greeting and posts an in-app notification to the whole active roster
 * (which doubles as tomorrow's "already sent" marker for this festival).
 */
export async function processTodaysFestival(): Promise<FestivalEntry | null> {
  const festival = getTodaysFestival();
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
    entityId: festival.key
  });

  return festival;
}
