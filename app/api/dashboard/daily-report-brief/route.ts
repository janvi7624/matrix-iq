import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { hasCapability } from '@/lib/permissions';
import { computeDailyReportRangeSummary, aggregateRangeRowsByDepartment } from '@/lib/dailyReportService';
import { lastClaimableMonth } from '@/lib/reimbursementPeriod';
import { monthKeyBounds } from '@/lib/dateHelpers';
import { monthKeyOf, monthLabelOf } from '@/lib/backOfficeDemoSummary';
import { getDeadlinePolicy } from '@/lib/dailyReportConfigStore';
import { istDate, workingDaysBetween } from '@/lib/dailyReportTime';
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
    const policy = await getDeadlinePolicy();
    const today = istDate(new Date());

    // One month's window, never running past today: a day that has not
    // happened cannot be a missing report. The Month preset on Team Daily
    // Reports takes the whole calendar month (lib/hrReportPeriod.ts
    // resolveRange), which for the month IN PROGRESS counts future working
    // days as expected and therefore as missing — on 29 Oct that inflated
    // October's missing count by 66 (33 employees x the 30th and 31st) and
    // dragged compliance from 73% down to 52%. A dashboard figure must not
    // report work as missed before it is due.
    const windowFor = (y: number, m: number) => {
      const key = monthKeyOf(y, m);
      const bounds = monthKeyBounds(key);
      const from = bounds?.from ?? '';
      const monthEnd = bounds ? new Date(new Date(bounds.to).getTime() - 86400000).toISOString().slice(0, 10) : '';
      return { key, from, monthEnd, to: monthEnd > today ? today : monthEnd };
    };

    const previous = lastClaimableMonth();
    let w = windowFor(previous.year, previous.month);

    // Fall forward to the current month when the previous one has no tracked
    // working days at all. That happens whenever the month predates
    // TRACKING_START_DATE (lib/dailyReportTime.ts) — workingDaysBetween
    // floors every range at it — and the widget would otherwise show a table
    // of zeros for the whole of the following month, which says nothing.
    const previousHasData = workingDaysBetween(w.from, w.to, policy).length > 0;
    if (!previousHasData) {
      const [cy, cm] = today.split('-').map(Number);
      w = windowFor(cy, cm);
    }

    // Labelled so a part-month is never mistaken for a closed one.
    const partialMonth = w.to < w.monthEnd;
    const monthLabel = monthLabelOf(w.key) + (partialMonth ? ' (to date)' : '');

    const departments = await listActiveDepartments();
    const summary = await computeDailyReportRangeSummary(departments.map((d) => d.id), w.from, w.to, { label: monthLabel });
    const rows = aggregateRangeRowsByDepartment(summary.rows);

    return NextResponse.json({
      monthLabel,
      rows,
      totals: summary.totals,
      // So the widget can say what it is actually showing.
      monthKey: w.key,
      from: w.from,
      to: w.to,
      partialMonth,
      showingCurrentMonthBecausePreviousHadNoData: !previousHasData
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
