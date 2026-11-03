import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualString } from '@/lib/dailyReportCronAuth';
import { runBackOfficeMonthlySummary } from '@/lib/backOfficeMonthlySummaryJob';

// "Every month's 1st date the Back Office manager should get a mail of
// summary of last month" — demos, total expense and the month's totals.
//
// Now a thin, authenticated door onto lib/backOfficeMonthlySummaryJob.ts.
// The job moved there because the external cron this route was written for
// never existed on this deployment: back_office_monthly_summary_runs held
// ZERO rows, so Back Office had never received one. The self-scheduling
// daily-report sweep now runs the same job
// (lib/dailyReportAutoSweep.ts), which needs no crontab.
//
// The endpoint stays so an external cron still works, and as the way to
// trigger the job on demand. The job claims its month before sending, so
// calling it both ways cannot double-mail.
//
//   # crontab — optional now; once a day, IST host
//   0 2 * * * curl -fsS -X POST -H "Authorization: Bearer $BACKOFFICE_SUMMARY_CRON_SECRET" \
//     https://your-host/api/cron/backoffice-monthly-summary
//
// AUTH. Same shape as the sweep: a cron process carries no session cookie,
// so this route is in proxy.ts's PUBLIC_PATHS and authenticates with a
// shared secret. Fails closed (503) when unset.

export const dynamic = 'force-dynamic';

function authorize(request: NextRequest): NextResponse | null {
  const secret = process.env.BACKOFFICE_SUMMARY_CRON_SECRET;
  if (!secret) {
    console.error(
      '[backoffice-monthly-summary] BACKOFFICE_SUMMARY_CRON_SECRET is not set, so this endpoint is refusing requests. Set it in the server environment and use it as the Bearer token from your cron entry. NOTE: the in-app sweep runs this job regardless, so an unset secret no longer means the summary does not go out.'
    );
    return NextResponse.json({ error: 'The Back Office monthly summary job is not configured on this deployment.' }, { status: 503 });
  }

  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const alternative = request.headers.get('x-cron-secret') || '';
  const supplied = bearer || alternative;

  if (!supplied || !timingSafeEqualString(supplied, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

async function run(request: NextRequest): Promise<NextResponse> {
  const denied = authorize(request);
  if (denied) return denied;
  return NextResponse.json(await runBackOfficeMonthlySummary());
}

export async function POST(request: NextRequest) {
  return run(request);
}

// GET is accepted too — several managed cron services only issue GET. Same
// guarded, idempotent operation either way.
export async function GET(request: NextRequest) {
  return run(request);
}
