import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { buildPerformanceReview } from '@/lib/performanceReview';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

// Backs the Person Performance Dashboard modal opened from a Department
// Health drill-down (components/DepartmentHealthDetail.tsx via
// components/PersonPerformanceDashboard.tsx). Deliberately NOT under
// /api/admin/* — that prefix is blanket-gated on session.isPrivileged
// (proxy.ts), which would wrongly block a department manager who manages a
// department but isn't personally flagged privileged (isPrivileged and
// "manages a department" are independent — see lib/departmentScope.ts).
// Authorization instead mirrors app/api/dashboard/health/[department]/
// route.ts exactly: org-wide viewers can open anyone, everyone else only a
// person within their own resolveVisibilityScope (their managed
// department's roster, or themselves).
export async function GET(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { username } = await params;

    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide) {
      const target = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
      const targetId = target ? (target.get('id') as string) : '';
      if (!targetId || !(scope.scopedUserIds ?? []).includes(targetId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const review = await buildPerformanceReview(username);
    if (!review) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(review);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
