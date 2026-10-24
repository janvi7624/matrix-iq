import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { cached, invalidateCache } from './memoCache';
import { DailyReportConfigRecord } from './dailyReportTypes';
import { DeadlinePolicy, isClockTime, isIsoDate, TRACKING_START_DATE } from './dailyReportTime';

// The module's policy, as one singleton row. Read on every report page load,
// every API write and every scheduler tick but written only from Daily
// Report Configuration, so it uses the same cache-with-explicit-invalidation
// pattern as roleStore/departmentStore/appConfigStore.
const CONFIG_CACHE_KEY = 'dailyReportConfig';
const CONFIG_CACHE_TTL_MS = 30_000;

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

// Mon–Sat working week, 11:00 deadline on the next working day, 9 PM and
// 10 AM reminders, 3 active warnings to HR. These reproduce the stated
// policy exactly, so the first read of a fresh install already behaves as
// specified without an admin having to configure anything.
//
// The two exceptions are deliberate and both fail safe: scheduler_enabled is
// FALSE and dry_run is TRUE, so a deployment never starts emailing staff
// merely because the migration ran. Arming it is two explicit admin actions.
export const DEFAULT_DAILY_REPORT_CONFIG: Omit<DailyReportConfigRecord, 'id' | 'updated_at' | 'updated_by_name'> = {
  timezone: 'Asia/Kolkata',
  working_days: [1, 2, 3, 4, 5, 6],
  holidays: [],
  observe_holidays: false,
  // This company's policy: the third Saturday of every month is off.
  off_nth_weekdays: [{ nth: 3, weekday: 6 }],
  deadline_time: '11:00',
  evening_reminder_time: '21:00',
  final_reminder_time: '10:00',
  sales_auto_submit_time: '10:30',
  warning_threshold: 3,
  reconcile_window_days: 7,
  scheduler_enabled: false,
  dry_run: true,
  leave_rejection_policy: 'reinstate',
  exempt_employee_ids: []
};

const updaterInclude = { model: db.User, as: 'updater', attributes: ['id', 'username', 'name'] };

function toRecord(row: Model): DailyReportConfigRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const updater = plain.updater as { name?: string; username?: string } | null;
  const workingDays = Array.isArray(plain.working_days) ? (plain.working_days as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [];
  return {
    id: plain.id as string,
    timezone: (plain.timezone as string) || DEFAULT_DAILY_REPORT_CONFIG.timezone,
    // A row somehow left with no working days would make every date a
    // non-working day and silently switch the whole module off, so fall back
    // to the default rather than trusting an empty list.
    working_days: workingDays.length ? workingDays : [...DEFAULT_DAILY_REPORT_CONFIG.working_days],
    holidays: Array.isArray(plain.holidays) ? (plain.holidays as unknown[]).filter(isIsoDate) : [],
    observe_holidays: Boolean(plain.observe_holidays),
    off_nth_weekdays: Array.isArray(plain.off_nth_weekdays)
      ? (plain.off_nth_weekdays as { nth?: unknown; weekday?: unknown }[])
          .map((rule) => ({ nth: Number(rule?.nth), weekday: Number(rule?.weekday) }))
          .filter((rule) => Number.isInteger(rule.nth) && rule.nth >= 1 && rule.nth <= 5 && Number.isInteger(rule.weekday) && rule.weekday >= 0 && rule.weekday <= 6)
      : [],
    deadline_time: isClockTime(plain.deadline_time) ? (plain.deadline_time as string) : DEFAULT_DAILY_REPORT_CONFIG.deadline_time,
    evening_reminder_time: isClockTime(plain.evening_reminder_time) ? (plain.evening_reminder_time as string) : DEFAULT_DAILY_REPORT_CONFIG.evening_reminder_time,
    final_reminder_time: isClockTime(plain.final_reminder_time) ? (plain.final_reminder_time as string) : DEFAULT_DAILY_REPORT_CONFIG.final_reminder_time,
    sales_auto_submit_time: isClockTime(plain.sales_auto_submit_time) ? (plain.sales_auto_submit_time as string) : DEFAULT_DAILY_REPORT_CONFIG.sales_auto_submit_time,
    warning_threshold: Math.max(1, Number(plain.warning_threshold) || DEFAULT_DAILY_REPORT_CONFIG.warning_threshold),
    reconcile_window_days: Math.max(0, Number(plain.reconcile_window_days) ?? DEFAULT_DAILY_REPORT_CONFIG.reconcile_window_days),
    scheduler_enabled: Boolean(plain.scheduler_enabled),
    dry_run: Boolean(plain.dry_run),
    leave_rejection_policy: plain.leave_rejection_policy === 'waive' ? 'waive' : 'reinstate',
    exempt_employee_ids: Array.isArray(plain.exempt_employee_ids)
      ? (plain.exempt_employee_ids as unknown[]).filter((id): id is string => typeof id === 'string' && isUuid(id))
      : [],
    updated_at: isoOrEmpty(plain.updatedAt),
    updated_by_name: updater?.name ?? updater?.username ?? ''
  };
}

async function ensureRow(): Promise<void> {
  const count = await db.DailyReportConfig.count();
  if (count === 0) await db.DailyReportConfig.create({} as never);
}

export async function getDailyReportConfig(): Promise<DailyReportConfigRecord> {
  return cached(CONFIG_CACHE_KEY, CONFIG_CACHE_TTL_MS, async () => {
    await ensureRow();
    const row = await db.DailyReportConfig.findOne({ include: [updaterInclude] as never });
    return toRecord(row as Model);
  });
}

/**
 * The config narrowed to exactly what the date arithmetic needs
 * (lib/dailyReportTime.ts's DeadlinePolicy). Every deadline, reminder time
 * and working-day decision in the module goes through this, so there is one
 * answer to "when was this due" rather than one per caller.
 */
export async function getDeadlinePolicy(): Promise<DeadlinePolicy> {
  const config = await getDailyReportConfig();
  return {
    workingDays: config.working_days,
    holidays: config.holidays,
    observeHolidays: config.observe_holidays,
    offNthWeekdays: config.off_nth_weekdays,
    deadlineTime: config.deadline_time,
    eveningReminderTime: config.evening_reminder_time,
    finalReminderTime: config.final_reminder_time,
    // The one place the floor is applied, so every obligation in the module —
    // the sweep's window, the HR and team compliance views, analytics, the
    // monthly summary, an employee's own history — starts from the same day.
    trackingStartDate: TRACKING_START_DATE
  };
}

export class InvalidDailyReportConfigError extends Error {}

export interface DailyReportConfigPatch {
  working_days?: number[];
  holidays?: string[];
  observe_holidays?: boolean;
  off_nth_weekdays?: { nth: number; weekday: number }[];
  deadline_time?: string;
  evening_reminder_time?: string;
  final_reminder_time?: string;
  sales_auto_submit_time?: string;
  warning_threshold?: number;
  reconcile_window_days?: number;
  scheduler_enabled?: boolean;
  dry_run?: boolean;
  leave_rejection_policy?: 'reinstate' | 'waive';
  exempt_employee_ids?: string[];
}

// Validated here rather than only in the route, because the scheduler reads
// this row unattended: a deadline_time of "25:00" or an empty working week
// would not fail a request, it would quietly stop every reminder in the
// company. `timezone` is deliberately NOT patchable — the date arithmetic is
// fixed-offset IST by design (see lib/dailyReportTime.ts), so accepting
// another zone here would store a value nothing honours.
export async function updateDailyReportConfig(patch: DailyReportConfigPatch, updatedByUserId: string | null): Promise<DailyReportConfigRecord> {
  await ensureRow();
  const attrs: Record<string, unknown> = { updated_by: updatedByUserId };

  if (patch.working_days !== undefined) {
    const days = Array.from(new Set(patch.working_days.map(Number))).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort();
    if (!days.length) throw new InvalidDailyReportConfigError('At least one working day is required.');
    attrs.working_days = days;
  }
  if (patch.holidays !== undefined) {
    const bad = patch.holidays.find((d) => !isIsoDate(d));
    if (bad) throw new InvalidDailyReportConfigError(`"${bad}" is not a valid date — use YYYY-MM-DD.`);
    attrs.holidays = Array.from(new Set(patch.holidays)).sort();
  }
  if (patch.observe_holidays !== undefined) attrs.observe_holidays = !!patch.observe_holidays;
  if (patch.off_nth_weekdays !== undefined) {
    const rules = (patch.off_nth_weekdays || []).map((rule) => ({ nth: Number(rule?.nth), weekday: Number(rule?.weekday) }));
    for (const rule of rules) {
      if (!Number.isInteger(rule.nth) || rule.nth < 1 || rule.nth > 5) throw new InvalidDailyReportConfigError('A recurring day off must be the 1st to 5th occurrence.');
      if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) throw new InvalidDailyReportConfigError('A recurring day off must name a valid weekday.');
    }
    // De-duplicated: the same rule twice would be harmless but would read as
    // two separate policies in the UI.
    const seen = new Set<string>();
    attrs.off_nth_weekdays = rules.filter((rule) => {
      const key = `${rule.nth}:${rule.weekday}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  for (const key of ['deadline_time', 'evening_reminder_time', 'final_reminder_time', 'sales_auto_submit_time'] as const) {
    if (patch[key] === undefined) continue;
    if (!isClockTime(patch[key])) throw new InvalidDailyReportConfigError(`${key.replace(/_/g, ' ')} must be a 24-hour HH:MM time.`);
    attrs[key] = patch[key];
  }

  if (patch.warning_threshold !== undefined) {
    const n = Number(patch.warning_threshold);
    if (!Number.isInteger(n) || n < 1 || n > 31) throw new InvalidDailyReportConfigError('The warning threshold must be between 1 and 31.');
    attrs.warning_threshold = n;
  }
  if (patch.reconcile_window_days !== undefined) {
    const n = Number(patch.reconcile_window_days);
    // Capped at 60: the window bounds how far back a catch-up run may reach,
    // and a very large value turns "the scheduler was off for a while" into
    // a retroactive warning spree. See sweepWindow in dailyReportSweepPlan.ts.
    if (!Number.isInteger(n) || n < 0 || n > 60) throw new InvalidDailyReportConfigError('The reconcile window must be between 0 and 60 days.');
    attrs.reconcile_window_days = n;
  }
  if (patch.scheduler_enabled !== undefined) attrs.scheduler_enabled = !!patch.scheduler_enabled;
  if (patch.dry_run !== undefined) attrs.dry_run = !!patch.dry_run;
  if (patch.leave_rejection_policy !== undefined) {
    if (patch.leave_rejection_policy !== 'reinstate' && patch.leave_rejection_policy !== 'waive') {
      throw new InvalidDailyReportConfigError('The leave rejection policy must be "reinstate" or "waive".');
    }
    attrs.leave_rejection_policy = patch.leave_rejection_policy;
  }

  if (patch.exempt_employee_ids !== undefined) {
    const ids = Array.from(new Set((patch.exempt_employee_ids || []).filter((id) => typeof id === 'string' && isUuid(id))));
    // Verified against real accounts rather than stored as given: a stale id
    // left here after someone is deleted would silently excuse nobody while
    // looking like it excused someone, which is the wrong way for a
    // compliance exemption to fail.
    if (ids.length) {
      const found = await db.User.findAll({ where: { id: ids } as never, attributes: ['id'] });
      const real = new Set(found.map((u) => u.get('id') as string));
      const unknown = ids.filter((id) => !real.has(id));
      if (unknown.length) throw new InvalidDailyReportConfigError('One or more selected people no longer exist.');
    }
    attrs.exempt_employee_ids = ids;
  }

  const row = await db.DailyReportConfig.findOne();
  await (row as Model).update(attrs as never);
  invalidateCache(CONFIG_CACHE_KEY);
  return getDailyReportConfig();
}
