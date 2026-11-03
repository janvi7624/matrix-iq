import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualString } from '@/lib/dailyReportCronAuth';
import { runDailyReportMonthlySummary } from '@/lib/dailyReportMonthlySummaryJob';

// "Every month's 1st date, the department manager should get a monthly
// summary of last month" + "a brief to Mayank Jani of all departments".
//
// This endpoint is now a thin, authenticated door onto
// lib/dailyReportMonthlySummaryJob.ts. The job itself moved there because
// the external cron this route was written for never existed on this
// deployment: monthly_summary_runs held ZERO rows, so neither the
// department summaries nor Mayank's all-departments brief had ever been
// sent once. The self-scheduling daily-report sweep now runs the same job
// (lib/dailyReportAutoSweep.ts), which does not depend on a crontab.
//
// The endpoint stays so an external cron still works for anyone who has
// one, and because it is the only way to trigger the job on demand. The job
// claims its month before sending, so calling both ways cannot double-mail.
//
//   # crontab — optional now; once a day, IST host
//   0 3 * * * curl -fsS -X POST -H "Authorization: Bearer $DAILY_REPORT_SUMMARY_CRON_SECRET" \
//     https://your-host/api/cron/daily-report-monthly-summary
//
// AUTH. A cron process carries no session cookie, so this route is in
// proxy.ts's PUBLIC_PATHS and authenticates with a shared secret. Fails
// closed (503) when the secret is unset — an unauthenticated endpoint that
// emails management must refuse every request rather than accept any caller.

export const dynamic = 'force-dynamic';

function authorize(request: NextRequest): NextResponse | null {
  const secret = process.env.DAILY_REPORT_SUMMARY_CRON_SECRET;
  if (!secret) {
    console.error(
      '[daily-report-summary] DAILY_REPORT_SUMMARY_CRON_SECRET is not set, so this endpoint is refusing requests. Set it in the server environment and use it as the Bearer token from your cron entry. NOTE: the in-app sweep runs this job regardless, so an unset secret no longer means the summaries do not go out.'
    );
    return NextResponse.json({ error: 'The Daily Report monthly summary job is not configured on this deployment.' }, { status: 503 });
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
  return NextResponse.json(await runDailyReportMonthlySummary());
}

export async function POST(request: NextRequest) {
  return run(request);
}

// GET is accepted too — several managed cron services only issue GET. Same
// guarded, idempotent operation either way.
export async function GET(request: NextRequest) {
  return run(request);
}
