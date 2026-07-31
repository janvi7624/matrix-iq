import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { projectStore } from '@/lib/projectStore';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { searchQuotations } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Aggregated counts for the Dashboard KPI row. Scoped the same way every
// other module is: admin/manager/superadmin see org-wide numbers, a plain
// user/technical account sees only what's built on their own projects.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [projects, siteVisits, demos, allQuotations] = await Promise.all([
      projectStore.list(viewer.username, viewer.isPrivileged),
      siteVisitStore.list(viewer.username, viewer.isPrivileged),
      demoScheduleStore.list(viewer.username, viewer.isPrivileged),
      searchQuotations()
    ]);

    const projectIds = new Set(projects.map((p) => p.id));
    const quotations = allQuotations.filter((q) => projectIds.has(q.project_id));

    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();

    const siteVisitsToday = siteVisits.filter((v) => v.visit_date === today).length;
    const upcomingDemos = demos.filter((d) => d.status === 'confirmed' && d.scheduled_at && new Date(d.scheduled_at).getTime() > now).length;
    const pendingResponses = projects.filter((p) => p.stage === 'customer_response').length;
    const negotiations = projects.filter((p) => p.stage === 'negotiation').length;
    const wonDeals = projects.filter((p) => p.status === 'won').length;
    const lostDeals = projects.filter((p) => p.status === 'lost').length;
    const decided = wonDeals + lostDeals;
    const conversionRate = decided > 0 ? Math.round((wonDeals / decided) * 100) : 0;

    return NextResponse.json({
      totalProjects: projects.length,
      siteVisitsToday,
      quotationsSent: quotations.length,
      upcomingDemos,
      pendingResponses,
      negotiations,
      wonDeals,
      lostDeals,
      conversionRate
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
