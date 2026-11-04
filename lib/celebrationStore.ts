import { db } from './db';
import { listUsers } from './userStore';
import { notifyUsers } from './notificationStore';
import { sendCelebrationEmail } from './email/notifications';

export type CelebrationType = 'birthday' | 'anniversary';

export interface CelebrationToday {
  userId: string;
  username: string;
  name: string;
  department: string;
  type: CelebrationType;
  years?: number; // anniversary only
}

function isTodayMonthDay(dateOnly: string, today: Date): boolean {
  if (!dateOnly) return false;
  const d = new Date(dateOnly + 'T00:00:00');
  return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

// Pure — no side effects, safe to call as often as needed (e.g. every
// dashboard load) purely to render the popup.
export async function getTodaysCelebrations(): Promise<CelebrationToday[]> {
  const users = await listUsers();
  const today = new Date();
  const results: CelebrationToday[] = [];

  for (const u of users) {
    if (u.status !== 'active') continue;

    if (u.birthday && isTodayMonthDay(u.birthday, today)) {
      results.push({ userId: u.id, username: u.username, name: u.name || u.username, department: u.department, type: 'birthday' });
    }

    if (u.dateOfJoining && isTodayMonthDay(u.dateOfJoining, today)) {
      const dojYear = new Date(u.dateOfJoining + 'T00:00:00').getFullYear();
      const years = today.getFullYear() - dojYear;
      // Joining today (0 years) isn't an anniversary yet.
      if (years > 0) {
        results.push({ userId: u.id, username: u.username, name: u.name || u.username, department: u.department, type: 'anniversary', years });
      }
    }
  }

  return results;
}

// Dedup marker: a Notification of this type targeted at the celebrant,
// created today, means the announcement + personal emails for THIS person
// were already sent — checked per celebrant rather than one global flag, so
// a birthday added mid-day can't cause a double-send for someone else.
//
// There is no cron/scheduler anywhere in this app (confirmed across the
// codebase) — everything only runs in response to an HTTP request. This is
// deliberately called from the dashboard's own GET (see
// app/api/dashboard/celebrations/route.ts) so the first person who opens
// the dashboard on a given day triggers today's celebration emails; this
// guard is what stops the 2nd, 3rd, ... person's dashboard load from
// re-sending them.
async function alreadyNotifiedToday(userId: string, type: string): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  // Op sourced from db.Sequelize (the exact class the connection/models were
  // built from) rather than a separate `import { Op } from 'sequelize'` —
  // see lib/userStore.ts's caseInsensitiveUsername() for why: some
  // production bundling setups end up with two distinct copies of the
  // sequelize package, and a Symbol from the "wrong" copy silently fails to
  // match inside the query generator built from the other one.
  const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };
  const count = await db.Notification.count({
    where: { userId, type, createdAt: { [Op.gte]: startOfDay } } as never
  });
  return count > 0;
}

// The actual orchestration: figures out who's celebrating today, and for
// anyone not already processed today, emails them personally, emails every
// other active teammate an announcement, and posts an in-app notification
// to the whole active roster (which doubles as tomorrow's dedup marker for
// this person).
export async function processTodaysCelebrations(): Promise<CelebrationToday[]> {
  const celebrations = await getTodaysCelebrations();
  if (!celebrations.length) return celebrations;

  const activeUsers = (await listUsers()).filter((u) => u.status === 'active');

  for (const c of celebrations) {
    const markerType = c.type === 'birthday' ? 'celebration_birthday' : 'celebration_anniversary';
    if (await alreadyNotifiedToday(c.userId, markerType)) continue;

    const celebrant = activeUsers.find((u) => u.id === c.userId);
    if (!celebrant) continue;
    const celebrantName = celebrant.name || celebrant.username;

    if (celebrant.email) {
      await sendCelebrationEmail({
        email: celebrant.email,
        name: celebrantName,
        audience: 'personal',
        type: c.type,
        celebrantName,
        years: c.years
      });
    }

    const others = activeUsers.filter((u) => u.id !== c.userId && u.email);
    await Promise.allSettled(
      others.map((u) =>
        sendCelebrationEmail({
          email: u.email,
          name: u.name || u.username,
          audience: 'announcement',
          type: c.type,
          celebrantName,
          years: c.years
        })
      )
    );

    const title = c.type === 'birthday'
      ? `🎉 It's ${celebrantName}'s birthday today!`
      : `🎊 ${celebrantName} completes ${c.years} year${c.years === 1 ? '' : 's'} today!`;
    const body = c.type === 'birthday'
      ? 'Wish them a happy birthday!'
      : `Celebrating ${c.years} year${c.years === 1 ? '' : 's'} with the company.`;

    await notifyUsers(activeUsers.map((u) => u.username), {
      title,
      body,
      type: markerType,
      entityType: 'user',
      entityId: c.userId
    });
  }

  return celebrations;
}

// The popup used to reappear on every dashboard visit for the whole day,
// deliberately, so a visit later in the day still caught it — but that made
// it show up "every time" someone logged in, which is what this caps.
// Tracked per-user in the DB (not per-browser/localStorage) so the limit
// holds across devices and sessions, not just on whichever one they saw it
// first. The date/count reset implicitly on the next day's first call
// (dateMatches becomes false), the same way processTodaysCelebrations'
// per-day dedup works — no cron needed to clear it.
const MAX_CELEBRATIONS_POPUP_VIEWS_PER_DAY = 3;

export async function shouldShowCelebrationsPopup(userId: string): Promise<boolean> {
  const user = await db.User.findByPk(userId, { attributes: ['id', 'celebrationPopupViewDate', 'celebrationPopupViewCount'] });
  if (!user) return false;

  const today = new Date().toISOString().slice(0, 10);
  const p = user.get({ plain: true }) as Record<string, unknown>;
  const dateMatches = p.celebrationPopupViewDate === today;
  const viewsToday = dateMatches ? Number(p.celebrationPopupViewCount) || 0 : 0;
  if (viewsToday >= MAX_CELEBRATIONS_POPUP_VIEWS_PER_DAY) return false;

  await user.update({ celebrationPopupViewDate: today, celebrationPopupViewCount: viewsToday + 1 } as never);
  return true;
}

export interface UpcomingCelebrationEntry {
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  date: string;
  daysAway: number;
  isToday: boolean;
  years?: number;
}

export interface UpcomingCelebrations {
  birthdays: UpcomingCelebrationEntry[];
  anniversaries: UpcomingCelebrationEntry[];
}

/**
 * Birthdays/work anniversaries in the next 30 days — the Dashboard's
 * "Upcoming Birthdays" / "Work Anniversaries" panels. A DIFFERENT window
 * than getTodaysCelebrations above (today only, drives the popup + email);
 * this one is purely a read, no side effects, safe to call as often as
 * needed.
 *
 * Extracted from app/api/hr-dashboard/route.ts (still the standalone
 * endpoint, now a thin wrapper around this) so app/api/dashboard/route.ts
 * can fold it into the Dashboard's one combined payload too. Despite the
 * name, that route was never HR-restricted — any signed-in viewer could
 * already call it.
 */
export async function getUpcomingCelebrations(): Promise<UpcomingCelebrations> {
  const users = await listUsers();
  const today = new Date();
  const birthdays: UpcomingCelebrationEntry[] = [];
  const anniversaries: UpcomingCelebrationEntry[] = [];

  const todayMonth = today.getMonth();
  const todayDate = today.getDate();
  const todayYear = today.getFullYear();

  for (const u of users) {
    if (u.status !== 'active') continue;

    if (u.birthday) {
      const bd = new Date(u.birthday + 'T00:00:00');
      const bdMonth = bd.getMonth();
      const bdDate = bd.getDate();

      const nextOccurrence = new Date(todayYear, bdMonth, bdDate);
      if (nextOccurrence < new Date(todayYear, todayMonth, todayDate)) {
        nextOccurrence.setFullYear(todayYear + 1);
      }
      const diffMs = nextOccurrence.getTime() - new Date(todayYear, todayMonth, todayDate).getTime();
      const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (daysAway <= 30) {
        birthdays.push({
          name: u.name, employeeId: u.employeeId, department: u.department,
          designation: u.designation, date: u.birthday,
          daysAway, isToday: daysAway === 0
        });
      }
    }

    if (u.dateOfJoining) {
      const doj = new Date(u.dateOfJoining + 'T00:00:00');
      const dojMonth = doj.getMonth();
      const dojDate = doj.getDate();
      const dojYear = doj.getFullYear();

      if (dojYear >= todayYear) continue;

      const nextOccurrence = new Date(todayYear, dojMonth, dojDate);
      if (nextOccurrence < new Date(todayYear, todayMonth, todayDate)) {
        nextOccurrence.setFullYear(todayYear + 1);
      }
      const diffMs = nextOccurrence.getTime() - new Date(todayYear, todayMonth, todayDate).getTime();
      const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24));
      const years = nextOccurrence.getFullYear() - dojYear;

      if (daysAway <= 30) {
        anniversaries.push({
          name: u.name, employeeId: u.employeeId, department: u.department,
          designation: u.designation, date: u.dateOfJoining,
          daysAway, isToday: daysAway === 0, years
        });
      }
    }
  }

  birthdays.sort((a, b) => a.daysAway - b.daysAway);
  anniversaries.sort((a, b) => a.daysAway - b.daysAway);

  return { birthdays, anniversaries };
}
