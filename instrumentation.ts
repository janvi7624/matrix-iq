// Next's server-startup hook: register() is called once per server instance,
// before it begins handling requests (node_modules/next/dist/docs/01-app/
// 02-guides/instrumentation.md).
//
// Used here for one thing only — arming the Daily Report sweep timer, so
// reminders and warnings go out on their own instead of waiting for somebody
// to press "Run Live Sweep". See lib/dailyReportAutoSweep.ts for why an
// in-process timer is acceptable for this particular job.
//
// Nothing here is awaited on the critical path: the import is dynamic so the
// edge runtime never pulls in Sequelize, and startDailyReportAutoSweep only
// sets a timer and returns. register() blocking would delay every boot.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startDailyReportAutoSweep } = await import('./lib/dailyReportAutoSweep');
  startDailyReportAutoSweep();
}
