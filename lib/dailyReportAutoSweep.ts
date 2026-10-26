import { runDailyReportSweep } from './dailyReportScheduler';

// Runs the Daily Report sweep on a timer inside the server process, so the
// module works without anybody installing a crontab entry or clicking "Run
// Live Sweep" on the admin page.
//
// WHY THIS NOW EXISTS. app/api/cron/daily-report-sweep/route.ts argues
// against an in-process scheduler, and that argument was right for the shape
// this app had then. Its three objections, answered:
//
//   "a setInterval fires once per instance" — true, and harmless here: every
//   side effect the sweep has is claimed through a unique row first
//   (claimNotificationEvent, claimEscalation), so a second instance running
//   the same minute finds the slot taken and sends nothing. Two instances
//   cost two cheap queries, not two emails.
//
//   "it restarts on every deploy" — the sweep is idempotent and works out
//   what is due from the clock rather than from where it left off, so a
//   restart loses nothing. It runs once on boot precisely so a deploy
//   reconciles anything missed while the process was down.
//
//   "it has nowhere to report a failure" — it does: every run writes a row to
//   daily_report_scheduler_runs with its status and stats, which is what the
//   admin page already reads. runDailyReportSweep never throws.
//
// The HTTP endpoint stays, and stays the better option where a real scheduler
// exists — it can be monitored by an uptime check and is unaffected by the
// app restarting. Running both is safe, for the claim-row reason above.
//
// WHAT STILL GATES IT. This only decides HOW OFTEN the sweep is attempted.
// Whether it does anything is unchanged: scheduler_enabled switches the whole
// thing off, dry_run keeps it a rehearsal, and both live in Daily Report
// Configuration. A tick on a disabled scheduler returns 'skipped'.

/** How often to look for work. */
const INTERVAL_MINUTES = 15;

/**
 * Wait before the first tick so a boot does not compete with the server
 * warming up — the first real request matters more than a sweep that is at
 * most fifteen minutes early.
 */
const FIRST_RUN_DELAY_MS = 30_000;

/** Set DAILY_REPORT_AUTO_SWEEP=off to rely on an external scheduler instead. */
function isDisabledByEnv(): boolean {
  const value = (process.env.DAILY_REPORT_AUTO_SWEEP || '').trim().toLowerCase();
  return value === 'off' || value === 'false' || value === '0';
}

// One timer per process. Stashed on the global for the same reason lib/db.ts
// caches the model registry there: in dev, Next re-evaluates modules on every
// hot reload, and without this each reload would leave another live interval
// behind until a dozen of them were sweeping at once.
declare global {
  // eslint-disable-next-line no-var
  var __nantaDailyReportSweepTimer: NodeJS.Timeout | undefined;
}

async function tick(reason: 'boot' | 'interval'): Promise<void> {
  try {
    const result = await runDailyReportSweep({ trigger: 'auto' });
    // Quiet on the ordinary no-op, so the log stays readable: a skipped run
    // every quarter hour is the expected state when the scheduler is off.
    if (result.status === 'skipped') return;
    const sent = Object.entries(result.stats.sent ?? {})
      .map(([kind, count]) => `${kind}=${count}`)
      .join(' ');
    console.info(
      `[daily-report] auto sweep (${reason}) ${result.status}${result.stats.dryRun ? ' [dry run]' : ''}` +
        `${sent ? ` — ${sent}` : ' — nothing due'}`
    );
    for (const failure of result.stats.failures ?? []) {
      console.error(`[daily-report] auto sweep failure: ${failure.kind} ${failure.employeeId} ${failure.reportDate} — ${failure.error}`);
    }
  } catch (error) {
    // runDailyReportSweep is documented never to throw, so reaching here
    // means something below it did — a dropped connection, most likely. The
    // timer must survive it: swallowing this is what keeps the next tick
    // from being the one that never comes.
    console.error('[daily-report] auto sweep threw, which it should not; the timer continues.', error);
  }
}

/**
 * Starts the timer. Safe to call more than once — only the first call does
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

  const timer = setInterval(() => void tick('interval'), INTERVAL_MINUTES * 60_000);
  // Never hold the process open on shutdown — a pending sweep is not a
  // reason to refuse to exit, and the next boot reconciles it anyway.
  timer.unref?.();
  global.__nantaDailyReportSweepTimer = timer;

  const first = setTimeout(() => void tick('boot'), FIRST_RUN_DELAY_MS);
  first.unref?.();

  console.info(
    `[daily-report] auto sweep armed — every ${INTERVAL_MINUTES} minutes, first run in ${Math.round(FIRST_RUN_DELAY_MS / 1000)}s. ` +
      'scheduler_enabled and dry_run in Daily Report Configuration still decide what it actually does.'
  );
}
