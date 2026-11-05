import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { canManageTargets } from '@/lib/targetAccess';
import { currentFiscalYear, fiscalYearOptions } from '@/lib/targetPeriod';
import { buildMonthlyTargetSeries } from '@/lib/targetSeries';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

// The 12-month Target vs Achieved series for the chart under the Target vs
// Achievement tiles (components/PersonPerformanceDashboard.tsx).
//
// Split out from ../route.ts rather than folded into it so that changing the
// fiscal year refetches ~12 rows instead of the whole person review, and so
// the series is never built for a viewer who will not be shown it.
// Authorization is deliberately identical to ../route.ts — the same
// resolveVisibilityScope check — plus canManageTargets, which is what gates
// the Target block this chart lives inside. Not under /api/admin/* for the
// same reason the parent route is not: that prefix is blanket-gated on
// session.isPrivileged, which would wrongly block a department manager.

// Reviews look backwards: the current fiscal year and the two before it.
const YEARS_BACK = 2;
const YEARS_FORWARD = 0;

export async function GET(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { username } = await params;

    const target = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
    const targetId = target ? (target.get('id') as string) : '';
    if (!targetId) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(targetId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!(await canManageTargets(viewer))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only a year from the offered window is accepted: fiscalYearStartYear
    // throws on a malformed label, and an arbitrary one would let a caller
    // ask for a span nobody has data for.
    const options = fiscalYearOptions(new Date(), YEARS_BACK, YEARS_FORWARD);
    const requested = request.nextUrl.searchParams.get('fiscalYear') || '';
    const fiscalYear = options.includes(requested) ? requested : currentFiscalYear();

    const series = await buildMonthlyTargetSeries(targetId, fiscalYear);
    return NextResponse.json({ ...series, fiscalYearOptions: options });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
