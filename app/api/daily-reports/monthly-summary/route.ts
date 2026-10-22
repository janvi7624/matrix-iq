import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getPeriodSummary } from '@/lib/dailyReportPeriodStore';
import { lastClaimableMonth } from '@/lib/reimbursementPeriod';
import { apiErrorResponse } from '@/lib/apiError';

// Last month's Daily Report compliance, for the dashboard.
//
// This is the half of "monthly summary on mail and in dashboard both" that
// needs nothing switched on: it is computed per request, so it works today,
// whereas the mail cannot send until scheduler_enabled is true, dry_run is
// false and DAILY_REPORT_CRON_SECRET is set on the deployment.
//
// Scope comes from getPeriodSummary's resolveDailyReportScope, so a department
// manager gets their own department and an admin (Mayank) gets every one —
// which is exactly the two audiences asked for, without a second code path.

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The inclusive last day of a month.
 *
 * Deliberately NOT lib/dateHelpers.ts's monthKeyBounds, whose `to` is the 1st
 * of the FOLLOWING month — an exclusive bound. getPeriodSummary treats `to` as
 * inclusive (Op.between, workingDaysBetween), so passing that straight through
 * would count an extra working day and attribute an obligation from the next
 * month to this one.
 */
function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requested = request.nextUrl.searchParams.get('month') || '';
  let year: number;
  let month: number;

  if (requested) {
    const match = MONTH_KEY.exec(requested);
    if (!match) return NextResponse.json({ error: 'month must be YYYY-MM.' }, { status: 400 });
    year = Number(match[1]);
    month = Number(match[2]);
  } else {
    // Default to the last COMPLETE month: a summary of the month in progress
    // would read as a collapse in compliance every 1st of the month.
    ({ year, month } = lastClaimableMonth());
  }

  try {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = lastDayOfMonth(year, month);
    const summary = await getPeriodSummary(viewer, {
      from,
      to,
      departmentId: request.nextUrl.searchParams.get('departmentId') || undefined
    });
    return NextResponse.json({
      monthKey: `${year}-${String(month).padStart(2, '0')}`,
      label: monthLabel(year, month),
      ...summary
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
