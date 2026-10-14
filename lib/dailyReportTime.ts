// Every date, deadline, reminder and month boundary in the Daily Report
// module is Asia/Kolkata, and this file is the only place that knows it.
//
// Implemented as fixed-offset arithmetic rather than Intl/`toLocaleString`
// round-trips or a date library (none is in package.json, and adding one for
// this is not worth the dependency). India has been UTC+5:30 with no DST
// since 1945 — the offset genuinely is a constant, which is exactly why the
// cheap approach is also the correct one here. Everything a caller passes
// around is either a plain 'YYYY-MM-DD' IST calendar date or a real `Date`
// instant; there is deliberately no "local date" concept in between, since
// that is where timezone bugs live.
//
// Pure — no imports, no DB, no env. lib/dailyReportConfigStore.ts supplies
// the policy (which days are working days, what time the deadline is); this
// file only does the arithmetic.

export const IST_TIMEZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 330; // UTC+5:30

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** True for a syntactically valid, real calendar date in 'YYYY-MM-DD' form. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  // Rejects 2026-02-30 and friends — Date.UTC happily rolls those over.
  const [, y, m, d] = match;
  const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return utc.getUTCFullYear() === Number(y) && utc.getUTCMonth() === Number(m) - 1 && utc.getUTCDate() === Number(d);
}

/** True for a 24-hour 'HH:MM' clock time. */
export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** The IST calendar date an instant falls on. */
export function istDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** The IST wall-clock time ('HH:MM') an instant falls on. */
export function istClock(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/**
 * The instant at which a given IST wall-clock time on a given IST date
 * occurs. `at('2026-10-17', '11:00')` is 05:30Z on the 17th.
 */
export function istInstant(date: string, clock: string): Date {
  const match = DATE_RE.exec(date);
  const time = TIME_RE.exec(clock);
  if (!match || !time) throw new Error(`Invalid IST date/time: ${date} ${clock}`);
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const minutes = Number(time[1]) * 60 + Number(time[2]);
  return new Date(utcMidnight + (minutes - IST_OFFSET_MINUTES) * 60_000);
}

/** 0 = Sunday … 6 = Saturday, for an IST calendar date. */
export function dayOfWeek(date: string): number {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid IST date: ${date}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** Calendar-date arithmetic in IST. `days` may be negative. */
export function addDays(date: string, days: number): string {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid IST date: ${date}`);
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * MS_PER_DAY);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 'YYYY-MM' — the calendar month a reporting date belongs to, which is the
 *  grain warnings and HR escalations are counted and capped on. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Inclusive count of calendar days from `from` to `to` (negative if reversed). */
export function daysBetween(from: string, to: string): number {
  const a = istInstant(from, '00:00').getTime();
  const b = istInstant(to, '00:00').getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

// The subset of Daily Report config this file needs. Declared structurally
// rather than imported from the config store so this module stays free of
// any DB-touching import and remains trivially unit-testable.
export interface WorkingDayPolicy {
  /** Day-of-week numbers that are working days. Default Mon–Sat = [1,2,3,4,5,6]. */
  workingDays: number[];
  /** 'YYYY-MM-DD' public holidays. Only consulted when observeHolidays is true. */
  holidays: string[];
  /**
   * False (the default) means "public holidays are treated as working days",
   * which is the documented interim policy until a real holiday calendar is
   * maintained — the list above is then inert rather than silently applied.
   */
  observeHolidays: boolean;
}

export function isWorkingDay(date: string, policy: WorkingDayPolicy): boolean {
  if (!policy.workingDays.includes(dayOfWeek(date))) return false;
  if (policy.observeHolidays && policy.holidays.includes(date)) return false;
  return true;
}

// Bounded so a misconfiguration (e.g. workingDays: []) can never spin
// forever inside a scheduler tick — it surfaces as a thrown, logged error
// instead of a hung job.
const MAX_WORKING_DAY_SEARCH = 60;

export function nextWorkingDay(date: string, policy: WorkingDayPolicy): string {
  for (let i = 1; i <= MAX_WORKING_DAY_SEARCH; i++) {
    const candidate = addDays(date, i);
    if (isWorkingDay(candidate, policy)) return candidate;
  }
  throw new Error(`No working day found within ${MAX_WORKING_DAY_SEARCH} days of ${date} — check the working-day configuration.`);
}

export function previousWorkingDay(date: string, policy: WorkingDayPolicy): string {
  for (let i = 1; i <= MAX_WORKING_DAY_SEARCH; i++) {
    const candidate = addDays(date, -i);
    if (isWorkingDay(candidate, policy)) return candidate;
  }
  throw new Error(`No working day found within ${MAX_WORKING_DAY_SEARCH} days before ${date} — check the working-day configuration.`);
}

/** Every working day in [from, to], inclusive. */
export function workingDaysBetween(from: string, to: string, policy: WorkingDayPolicy): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isWorkingDay(d, policy)) days.push(d);
  }
  return days;
}

export interface DeadlinePolicy extends WorkingDayPolicy {
  /** 'HH:MM' IST — when a report becomes late. Default '11:00'. */
  deadlineTime: string;
  /** 'HH:MM' IST on the reporting date itself. Default '21:00'. */
  eveningReminderTime: string;
  /** 'HH:MM' IST on the deadline day. Default '10:00'. */
  finalReminderTime: string;
}

export interface ReportSchedule {
  reportDate: string;
  /** The working day the deadline falls on — Saturday's is Monday. */
  deadlineDate: string;
  deadlineAt: Date;
  /** First nudge, 9:00 PM on the reporting date itself. */
  eveningReminderAt: Date;
  /** Final nudge on the deadline day; its copy states one hour remains. */
  finalReminderAt: Date;
}

/**
 * The single authoritative deadline computation. The scheduler, the
 * on-time/late decision at submit, the employee page's countdown and the
 * analytics compliance numbers all read it from here, so none of them can
 * quietly disagree about when a report was due.
 */
export function scheduleFor(reportDate: string, policy: DeadlinePolicy): ReportSchedule {
  const deadlineDate = nextWorkingDay(reportDate, policy);
  return {
    reportDate,
    deadlineDate,
    deadlineAt: istInstant(deadlineDate, policy.deadlineTime),
    eveningReminderAt: istInstant(reportDate, policy.eveningReminderTime),
    finalReminderAt: istInstant(deadlineDate, policy.finalReminderTime)
  };
}

/** Whether a submission at `submittedAt` counts as late for `reportDate`. */
export function isLateSubmission(reportDate: string, submittedAt: Date, policy: DeadlinePolicy): boolean {
  return submittedAt.getTime() > scheduleFor(reportDate, policy).deadlineAt.getTime();
}

/**
 * The previous and next working day a reader may navigate to from
 * `reportDate`, given that `today` is as far forward as anything can go.
 *
 * `prev` is always a real date — history can be walked back indefinitely.
 * `next` is '' once the next working day has not happened yet, which is what
 * stops a forward arrow from walking into the future. Both skip Sundays and
 * holidays via the same policy the deadline engine uses, so navigation can
 * never land on a day no report was ever expected for.
 *
 * Pure and separate from the page that uses it specifically so the
 * future-cap rule is unit-testable — it was previously an inline expression
 * in a DB-bound function, where the one case that actually mattered (being
 * on the most recent working day) could not be covered.
 */
export function navigableWorkingDays(reportDate: string, today: string, policy: WorkingDayPolicy): { prev: string; next: string } {
  const candidate = nextWorkingDay(reportDate, policy);
  return { prev: previousWorkingDay(reportDate, policy), next: candidate <= today ? candidate : '' };
}

/**
 * Human-readable IST stamp for emails and audit remarks — deliberately
 * formatted here rather than with toLocaleString(…, { timeZone }), so a
 * server with an odd ICU build can't produce a different string than the one
 * the rest of the module computed from.
 */
export function formatIst(instant: Date): string {
  return `${istDate(instant)} ${istClock(instant)} IST`;
}
