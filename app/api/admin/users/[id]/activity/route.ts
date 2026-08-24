import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { projectStore } from '@/lib/projectStore';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { searchQuotationsFiltered } from '@/lib/quotationStore';
import { listLoginHistory } from '@/lib/loginHistoryStore';
import { apiErrorResponse } from '@/lib/apiError';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { canViewRole } from '@/lib/permissions';

const RECENT_LIMIT = 5;

// Base auth + admin/superadmin gating happens in proxy.ts (matcher:
// /api/admin/:path*) — that's a capability check only, so a department
// manager reaching this admin page is additionally clamped to their own
// department's people here, same as the list at /api/admin/users.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const user = await findUserById(id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (!canViewRole(session.role, user.role)) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const scope = await resolveVisibilityScope(session.username);
    if (!scope.seesOrgWide && !scope.scopedUserIds!.includes(id)) {
      return NextResponse.json({ error: 'Forbidden — outside your department' }, { status: 403 });
    }

    const [projects, siteVisits, quotations, demos, loginHistory] = await Promise.all([
      projectStore.listOwnedBy(user.username),
      siteVisitStore.listOwnedBy(user.username),
      searchQuotationsFiltered({ ownerUsername: user.username }),
      demoScheduleStore.list(user.username, false),
      listLoginHistory(user.username, 10)
    ]);

    return NextResponse.json({
      projects: {
        total: projects.length,
        recent: projects.slice(0, RECENT_LIMIT).map((p) => ({ id: p.id, label: p.company || p.client_name, status: p.status, at: p.created_at }))
      },
      siteVisits: {
        total: siteVisits.length,
        recent: siteVisits.slice(0, RECENT_LIMIT).map((v) => ({ id: v.id, label: v.company_name, status: v.stage, at: v.created_at }))
      },
      quotations: {
        total: quotations.length,
        recent: quotations.slice(0, RECENT_LIMIT).map((q) => ({ id: q.id, label: q.quotation_number, status: q.status, at: q.created_at }))
      },
      demoRequests: {
        total: demos.length,
        recent: demos.slice(0, RECENT_LIMIT).map((d) => ({ id: d.id, label: d.company || d.client_name, status: d.status, at: d.created_at }))
      },
      loginHistory
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
