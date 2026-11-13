import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualString } from '@/lib/dailyReportCronAuth';
import { runFestivalCampaignSweep } from '@/lib/festivalCampaignStore';

// Client festival greeting campaigns — the scheduler entry point. Same
// arrangement as /api/cron/daily-report-sweep: listed in proxy.ts's
// PUBLIC_PATHS (a cron process has no session) and guarded by a shared
// secret instead, failing closed (503) when none is configured.
//
// Recommended cadence: hourly. The sweep is idempotent — it raises each
// festival's Marketing banner request once, and the festival-day send is
// claimed by a guarded UPDATE with a unique row per recipient.
//
//   0 * * * * curl -fsS -X POST -H "Authorization: Bearer $FESTIVAL_CAMPAIGN_CRON_SECRET" \
//     https://your-host/api/cron/festival-campaigns
//
// FESTIVAL_CAMPAIGN_CRON_SECRET falls back to DAILY_REPORT_CRON_SECRET so an
// existing crontab's secret works without adding a second variable.

export const dynamic = 'force-dynamic';
// A live send to ~1,300 clients at 8/s takes a few minutes.
export const maxDuration = 900;

function authorize(request: NextRequest): NextResponse | null {
  const secret = process.env.FESTIVAL_CAMPAIGN_CRON_SECRET || process.env.DAILY_REPORT_CRON_SECRET;
  if (!secret) {
    console.error('[festival-campaign] No FESTIVAL_CAMPAIGN_CRON_SECRET (or DAILY_REPORT_CRON_SECRET) is set — refusing the scheduler call.');
    return NextResponse.json({ error: 'The festival campaign scheduler is not configured on this deployment.' }, { status: 503 });
  }
  const header = request.headers.get('authorization') || '';
  const supplied = (header.startsWith('Bearer ') ? header.slice(7) : '') || request.headers.get('x-cron-secret') || '';
  if (!supplied || !timingSafeEqualString(supplied, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

async function sweep(request: NextRequest): Promise<NextResponse> {
  const denied = authorize(request);
  if (denied) return denied;
  const result = await runFestivalCampaignSweep();
  return NextResponse.json(result, { status: result.errors.length ? 207 : 200 });
}

export async function POST(request: NextRequest) {
  return sweep(request);
}

export async function GET(request: NextRequest) {
  return sweep(request);
}
