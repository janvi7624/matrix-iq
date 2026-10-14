import { NextRequest, NextResponse } from 'next/server';
import { runDailyReportSweep } from '@/lib/dailyReportScheduler';
import { timingSafeEqualString } from '@/lib/dailyReportCronAuth';

// The Daily Report scheduler's entry point.
//
// This app has no in-process scheduler, and deliberately still doesn't: a
// setInterval inside a Next.js server would fire once per instance, restart
// on every deploy, and have nowhere to report a failure. Instead the job is
// an idempotent HTTP endpoint and an external scheduler calls it on a fixed
// cadence. The endpoint works out what is due, which means it does not need
// to be called at 21:00 exactly — only sometime after.
//
// Recommended cadence: hourly, on the hour. The sweep is cheap when nothing
// is due (three indexed queries and a pure planning pass), every side effect
// is guarded by a unique database row, and a missed hour is reconciled by
// the next call. Running it more often is harmless; running it less often
// delays a reminder rather than losing it.
//
//   # crontab — every hour, on the hour, IST host
//   0 * * * * curl -fsS -X POST -H "Authorization: Bearer $DAILY_REPORT_CRON_SECRET" \
//     https://your-host/api/cron/daily-report-sweep >> /var/log/matrixiq-daily-report.log 2>&1
//
// AUTH. This route is in proxy.ts's PUBLIC_PATHS because a cron process
// carries no session cookie — it authenticates with a shared secret instead,
// the same arrangement the Meta webhook route already uses for the same
// reason. With DAILY_REPORT_CRON_SECRET unset the route refuses every
// request (503): an unauthenticated endpoint that emails the entire company
// must fail closed, so a deployment that forgets the variable gets no
// reminders rather than an open trigger.
//
// Beyond the secret, the two switches in Daily Report Configuration still
// apply — scheduler_enabled gates everything and dry_run keeps it a
// rehearsal — so reaching this endpoint is not by itself enough to mail
// anybody.

export const dynamic = 'force-dynamic';

function authorize(request: NextRequest): NextResponse | null {
  const secret = process.env.DAILY_REPORT_CRON_SECRET;
  if (!secret) {
    console.error(
      '[daily-report] DAILY_REPORT_CRON_SECRET is not set, so the reminder scheduler endpoint is refusing requests. Set it in the server environment and use it as the Bearer token from your cron entry.'
    );
    return NextResponse.json({ error: 'The daily report scheduler is not configured on this deployment.' }, { status: 503 });
  }

  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Also accepted as a header, for schedulers (and some managed cron
  // services) that don't let you set Authorization.
  const alternative = request.headers.get('x-cron-secret') || '';
  const supplied = bearer || alternative;

  // Compared in constant time: a plain === leaks the secret's prefix to
  // anyone who can measure response latency across many attempts.
  if (!supplied || !timingSafeEqualString(supplied, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

async function sweep(request: NextRequest): Promise<NextResponse> {
  const denied = authorize(request);
  if (denied) return denied;

  // runDailyReportSweep never throws — every failure is recorded on the run
  // row and returned in `stats.failures`, because the caller is a cron
  // process with nowhere to put an exception.
  const result = await runDailyReportSweep({ trigger: 'cron' });

  // The HTTP status is chosen so an uptime monitor pointed at this URL is
  // actually useful: a sweep that could not finish is a 500, one that
  // partially failed is a 207, and "the scheduler is switched off" is a
  // deliberate 200 rather than an error, because that is a configuration
  // choice and not a fault.
  const status = result.status === 'failed' ? 500 : result.status === 'partial' ? 207 : 200;
  return NextResponse.json(result, { status });
}

export async function POST(request: NextRequest) {
  return sweep(request);
}

// GET is accepted too — plenty of managed cron services and uptime checkers
// can only issue a GET. It is the same guarded, idempotent operation.
export async function GET(request: NextRequest) {
  return sweep(request);
}
