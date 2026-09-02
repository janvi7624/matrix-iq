import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/apiError';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { buildPerformanceReview } from '@/lib/performanceReview';
import { db } from '@/lib/db';

// Aggregates one employee's activity across every module for the
// Performance Review dashboard (section 23) — see lib/performanceReview.ts
// for the actual data assembly, shared with the Dashboard's Person
// Performance drill-down (app/api/dashboard/person/[username]/route.ts).
// Route access itself (Super Admin/Admin/Manager only) is enforced by
// proxy.ts's /api/admin/* privileged gate, but that gate only checks
// isPrivileged (a capability), not department scope — a department-scoped
// manager can still reach this admin page, so the check below additionally
// confirms the target employee is actually within THIS viewer's own
// department scope, closing the "swap the username in the URL" gap.
export async function GET(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  try {
    const viewer = await getViewerContext(request);
    if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide) {
      const target = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
      const targetId = target ? (target.get('id') as string) : '';
      if (!targetId || !scope.scopedUserIds!.includes(targetId)) {
        return NextResponse.json({ error: 'Forbidden — outside your department' }, { status: 403 });
      }
    }

    const review = await buildPerformanceReview(username);
    if (!review) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(review);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
