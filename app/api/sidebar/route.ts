import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';
import { computeLeadStats } from '@/lib/leadStore';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager } from '@/lib/permissions';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { deliveryChallanStore } from '@/lib/deliveryChallanStore';
import { listVisibleModules } from '@/lib/moduleConfigStore';

// Sidebar renders on every authenticated page and used to pay for its own
// /api/auth/me call, then — only once that resolved — up to 4 more
// sequential-feeling fetches for nav badges (leads/stats, marketing-requests/
// stats, projects/kpis, backoffice/kpis). One round trip here instead,
// resolving the viewer once and fanning the badge counts out in parallel.
// Deliberately separate from /api/dashboard (which computes a much larger,
// Dashboard-specific payload) — this stays cheap since it runs on every page
// navigation, not just the dashboard.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const isPrivileged = viewer.isPrivileged;
    const isBackOffice = viewer.role === 'backoffice' || isPrivileged;
    const isManagerTier = viewer.role === 'manager' || viewer.role === 'admin' || viewer.role === 'superadmin';

    const user = await findUserNameAndDeptByUsername(viewer.username);

    const [modules, leadStats, isMarketingReviewer, demosForBadge, backOfficeCounts] = await Promise.all([
      listVisibleModules({ role: viewer.role, isPrivileged: viewer.isPrivileged, department: user?.department }),
      computeLeadStats(viewer.username, viewer.isPrivileged),
      isMarketingManager(viewer),
      viewer.role === 'technical' || isManagerTier ? demoScheduleStore.list(viewer.username, viewer.isPrivileged) : Promise.resolve(null),
      isBackOffice
        ? Promise.all([deliveryChallanStore.list(viewer.username, true), demoScheduleStore.list(viewer.username, true)])
        : Promise.resolve(null)
    ]);

    const badges: Record<string, number> = {};
    if (leadStats.unattended) badges.leads = leadStats.unattended;

    const marketingRecords = await marketingRequestStore.list(viewer.username, isMarketingReviewer);
    if (isMarketingReviewer) {
      const awaitingReview = marketingRecords.filter((r) => r.status === 'submitted').length;
      if (awaitingReview) badges['marketing-requests'] = awaitingReview;
    }

    if (demosForBadge) {
      const pendingApprovals = demosForBadge.filter((d) => d.status === 'pending_technical' || d.status === 'pending_manager').length;
      if (pendingApprovals) badges['demo-schedule'] = pendingApprovals;
    }

    if (backOfficeCounts) {
      const [dcs, backOfficeDemos] = backOfficeCounts;
      const dispatchedDemoIds = new Set(backOfficeDemos.filter((d) => d.status === 'demo_completed').map((d) => d.id));
      const pendingDc = backOfficeDemos.filter((d) => d.status === 'pending_backoffice').length;
      const pendingVerification = dcs.filter((d) => d.status === 'dispatched' && dispatchedDemoIds.has(d.demo_id)).length;
      const count = pendingDc + pendingVerification;
      if (count) badges.backoffice = count;
    }

    return NextResponse.json({
      modules,
      viewer: user ? { username: viewer.username, name: user.name, role: viewer.role, department: user.department } : null,
      badges
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
