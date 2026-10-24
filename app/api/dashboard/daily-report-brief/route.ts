import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { hasCapability } from '@/lib/permissions';
import { computeDailyReportRangeSummary, aggregateRangeRowsByDepartment } from '@/lib/dailyReportService';
import { lastClaimableMonth } from '@/lib/reimbursementPeriod';
import { monthKeyBounds } from '@/lib/dateHelpers';
import { monthKeyOf, monthLabelOf } from '@/lib/backOfficeDemoSummary';
import { listActiveDepartments } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';

// The dashboard half of "mail and in dashboard both" — the SAME
// all-departments brief app/api/cron/daily-report-monthly-summary emails to
// Mayank Jani specifically, computed fresh on every request rather than
// replaying the stored email, so it can never read as stale.
//
// Gated on the viewAllDepartments CAPABILITY, not on the one named
// username the email goes to: a dashboard widget hard-restricted to exactly
// one person's login would be an odd, inconsistent permission model next to
// every other org-wide dashboard panel in this app, and anyone who already
// sees every department's data has no less reason to see this too. Mayank
// sees it this way as a consequence of being an admin, same as everyone else
// who is.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await hasCapability(viewer.role, 'viewAllDepartments'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { year, month } = lastClaimableMonth();
    const monthKey = monthKeyOf(year, month);
    const monthLabel = monthLabelOf(monthKey);
    const bounds = monthKeyBounds(monthKey);
    const to = bounds ? new Date(new Date(bounds.to).getTime() - 86400000).toISOString().slice(0, 10) : '';
    const from = bounds?.from ?? '';

    const departments = await listActiveDepartments();
    const summary = await computeDailyReportRangeSummary(departments.map((d) => d.id), from, to, { label: monthLabel });
    const rows = aggregateRangeRowsByDepartment(summary.rows);

    return NextResponse.json({ monthLabel, rows, totals: summary.totals });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
