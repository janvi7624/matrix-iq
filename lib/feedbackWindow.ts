import { istDate } from './dailyReportTime';

/**
 * The feedback drive is deliberately temporary.
 *
 * It closes at the END of 18 November 2026 — the 18th is a collecting day,
 * not the cut-off. "Until the 18th" in ordinary speech includes the 18th,
 * and the alternative (closing at the start of the day) would surprise
 * anyone who left it to the last day.
 *
 * Dates are compared in IST, the same basis the daily-report module uses
 * (lib/dailyReportTime.ts). The server's own clock is not necessarily in
 * India, so a plain `new Date()` comparison would close the form hours
 * early or late for the people actually filling it in.
 *
 * Nothing schedules the removal: there is no cron job to fail and no flag
 * for anyone to forget to flip. Every surface asks isFeedbackWindowOpen()
 * and the whole feature disappears on its own on the 19th — the sidebar
 * tile, the page, and the submit endpoint together.
 */
export const FEEDBACK_WINDOW_LAST_DAY = '2026-11-18';

/**
 * Who may read the responses: the admin tier and nobody else.
 *
 * Deliberately NOT `isPrivileged`, which is a Role Management flag and is
 * currently also true for `manager` and `technical`. People answer this
 * form candidly about their own work and their own tools, under their own
 * name; the audience for that has to be a fixed, named list rather than
 * whatever a role flag happens to mean next month. HR is excluded for the
 * same reason — this is not an HR instrument.
 */
export const FEEDBACK_ADMIN_ROLES: string[] = ['superadmin', 'admin'];

/** Module key, shared by the registry entry and the visibility gate. */
export const FEEDBACK_MODULE_KEY = 'feedback';

export function isFeedbackWindowOpen(now: Date = new Date()): boolean {
  return istDate(now) <= FEEDBACK_WINDOW_LAST_DAY;
}

/** Whole days left, counting today. 0 once closed. */
export function feedbackDaysRemaining(now: Date = new Date()): number {
  const today = istDate(now);
  if (today > FEEDBACK_WINDOW_LAST_DAY) return 0;
  const [ty, tm, td] = today.split('-').map(Number);
  const [ly, lm, ld] = FEEDBACK_WINDOW_LAST_DAY.split('-').map(Number);
  const start = Date.UTC(ty, tm - 1, td);
  const end = Date.UTC(ly, lm - 1, ld);
  return Math.round((end - start) / 86_400_000) + 1;
}

/** "18 November 2026" — for the form, the email and the admin screen. */
export function feedbackWindowLastDayLabel(): string {
  const [y, m, d] = FEEDBACK_WINDOW_LAST_DAY.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${months[m - 1]} ${y}`;
}
