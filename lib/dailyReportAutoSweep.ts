import { runDailyReportSweep } from './dailyReportScheduler';
import { getDailyReportConfig } from './dailyReportConfigStore';
import { addDays, formatIst, istDate, istInstant } from './dailyReportTime';

// Runs the Daily Report sweep inside the server process, so the module works
// without anybody installing a crontab entry or clicking "Run Live Sweep".
//
// WHY THIS EXISTS AT ALL. app/api/cron/daily-report-sweep/route.ts argues
// against an in-process scheduler, and that argument was right for the shape
// this app had then. Its three objections, answered:
//
//   "a timer fires once per instance" — true, and harmless here: every side
//   effect the sweep has is claimed through a unique row first
//   (claimNotificationEvent, claimEscalation), so a second instance running
//   the same minute finds the slot taken and sends nothing.
//
//   "it restarts on every deploy" — the sweep is idempotent and works out what
//   is due from the clock rather than from where it left off. It runs once on
//   boot precisely so a deploy reconciles anything missed while it was down.
//
//   "it has nowhere to report a failure" — it does: every run writes a row to
//   daily_report_scheduler_runs. runDailyReportSweep never throws.
//
// The HTTP endpoint stays, and stays the better option where a real scheduler
// exists. Running both is safe, for the claim-row reason above.
//
// WHAT STILL GATES IT. This only decides WHEN the sweep is attempted. Whether
// it does anything is unchanged: scheduler_enabled switches the whole thing
// off and dry_run keeps it a rehearsal, both in Daily Report Configuration.

/**
 * The clock times the sweep actually has work at, in IST.
 *
 * Derived from Daily Report Configuration rather than hard-coded, because
 * these ARE the module's event times and an admin can move them:
 *
 *   final_reminder_time      10:00  the last nudge before the deadline
 *   sales_auto_submit_time   10:30  Sales/GEM-Sales auto-file
 *   deadline_time            11:30  a missed report becomes a WARNING
 *   evening_reminder_time    21:00  the first nudge, on the day itself
 *
 * The request was "10:00 and 21:00 rather than every fifteen minutes". Those
 * two are here — and so are the other two, deliberately. The sweep sends what
 * is DUE at the moment it runs, so waking only at 10:00 and 21:00 would hold
 * every warning back to 21:00 (9.5 hours late) and every sales auto-submit
 * with it (10.5 hours late). Four precise wake-ups a day is still 92 fewer
 * than the quarter-hourly poll this replaced.
 */
export function sweepClockTimes(config: {
  final_reminder_time?: string;
  sales_auto_submit_time?: string;
  deadline_time?: string;
  evening_reminder_time?: string;
}): string[] {
  const configured = [
    config.final_reminder_time,
    config.sales_auto_submit_time,
    config.deadline_time,
    config.evening_reminder_time
  ].filter((time): time is string => typeof time === 'string' && /^\d{2}:\d{2}$/.test(time));
  // Sorted and de-duplicated: two settings on the same minute are one wake-up,
  // and nextRunAt walks the list in order.
  return [...new Set(configured)].sort();
}

/**
 * The next instant one of those times comes round, in IST.
 *
 * Strictly after `now`, so finishing a run at exactly 10:00:00 schedules 10:30
 * rather than looping on the same minute. Rolls to tomorrow's first time once
 * the day's last one has gone.
 */
export function nextRunAt(times: string[], now: Date): Date | null {
  if (!times.length) return null;
  const today = istDate(now);
  for (const time of times) {
    const at = istInstant(today, time);
    if (at.getTime() > now.getTime()) return at;
  }
  return istInstant(addDays(today, 1), times[0]);
}

/** Used only when the configuration cannot be read at all — see scheduleNext. */
const FALLBACK_TIMES = ['10:00', '10:30', '11:30', '21:00'];

/**
 * Wait before the catch-up run so a boot does not compete with the server
 * warming up — the first real request matters more.
 */
const FIRST_RUN_DELAY_MS = 30_000;

/** Set DAILY_REPORT_AUTO_SWEEP=off to rely on an external scheduler instead. */
function isDisabledByEnv(): boolean {
  const value = (process.env.DAILY_REPORT_AUTO_SWEEP || '').trim().toLowerCase();
  return value === 'off' || value === 'false' || value === '0';
}

// One chain per process. Stashed on the global for the same reason lib/db.ts
// caches the model registry there: in dev, Next re-evaluates modules on every
// hot reload, and without this each reload would leave another live chain
// behind until a dozen of them were sweeping at once.
declare global {
  // eslint-disable-next-line no-var
  var __nantaDailyReportSweepTimer: NodeJS.Timeout | undefined;
}

async function tick(reason: 'boot' | 'scheduled'): Promise<void> {
  try {
    const result = await runDailyReportSweep({ trigger: 'auto' });
    // Quiet on the ordinary no-op: a skipped run is the expected state when
    // the scheduler is switched off.
    if (result.status === 'skipped') return;
    const sent = Object.entries(result.stats.sent ?? {})
      .map(([kind, count]) => `${kind}=${count}`)
      .join(' ');
    console.info(
      `[daily-report] auto sweep (${reason}) ${result.status}${result.stats.dryRun ? ' [dry run]' : ''}` +
        `${sent ? ` — ${sent}` : ' — nothing due'}`
    );
    for (const failure of result.stats.failures ?? []) {
      console.error(
        `[daily-report] auto sweep failure: ${failure.kind} ${failure.employeeId} ${failure.reportDate} — ${failure.error}`
      );
    }
  } catch (error) {
    // runDailyReportSweep is documented never to throw, so reaching here means
    // something below it did. The chain must survive it: swallowing this is
    // what keeps the next wake-up from being the one that never comes.
    console.error('[daily-report] auto sweep threw, which it should not; the schedule continues.', error);
  }
}

/**
 * Sleep until the next configured time, run, then do it again.
 *
 * A self-rescheduling setTimeout rather than one setInterval, because the gaps
 * are uneven (10:00 -> 10:30 -> 11:30 -> 21:00 -> 10:00 tomorrow). Re-reading
 * the configuration on every hop means moving a reminder time in the admin
 * page takes effect that same day instead of at the next deploy.
 */
async function scheduleNext(): Promise<void> {
  let times = FALLBACK_TIMES;
  try {
    const configured = sweepClockTimes(await getDailyReportConfig());
    if (configured.length) times = configured;
  } catch (error) {
    // A database that is not up yet must not end the chain — fall back to the
    // defaults and let the next hop re-read.
    console.error('[daily-report] could not read the sweep schedule; using the default times for now.', error);
  }

  const next = nextRunAt(times, new Date());
  if (!next) return;
  // +2s so a timer firing a hair early still lands inside the minute it was
  // aimed at, and can never re-select the slot it just ran.
  const delay = Math.max(1_000, next.getTime() - Date.now() + 2_000);

  const timer = setTimeout(() => {
    void tick('scheduled').finally(() => void scheduleNext());
  }, delay);
  // Never hold the process open on shutdown — a pending sweep is not a reason
  // to refuse to exit, and the next boot reconciles it anyway.
  timer.unref?.();
  global.__nantaDailyReportSweepTimer = timer;

  console.info(`[daily-report] next auto sweep at ${formatIst(next)} (schedule: ${times.join(', ')} IST).`);
}

/**
 * Arms the schedule. Safe to call more than once — only the first call does
 * anything. Returns immediately: nothing here is awaited, because
 * instrumentation's register() must finish before the server serves traffic.
 */
export function startDailyReportAutoSweep(): void {
  // Edge runtime has neither a database connection nor long-lived timers.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (isDisabledByEnv()) {
    console.info('[daily-report] auto sweep is switched off by DAILY_REPORT_AUTO_SWEEP.');
    return;
  }
  if (global.__nantaDailyReportSweepTimer) return;
  // Claim the slot before the first await, so two near-simultaneous calls
  // cannot both arm a chain.
  global.__nantaDailyReportSweepTimer = setTimeout(() => undefined, 0);

  // One catch-up run shortly after boot. A deploy that restarts across a
  // scheduled time would otherwise skip it until tomorrow, and the sweep is
  // cheap when nothing is due.
  const first = setTimeout(() => void tick('boot'), FIRST_RUN_DELAY_MS);
  first.unref?.();

  void scheduleNext();
  console.info('[daily-report] auto sweep armed — waking at the configured event times, not on an interval.');
}
