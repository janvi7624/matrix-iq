import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { listVisibleModules } from '@/lib/moduleConfigStore';
import { projectStore } from '@/lib/projectStore';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { deliveryChallanStore } from '@/lib/deliveryChallanStore';
import { countQuotationsForProjects, computeEffectiveStatus, searchQuotationsFiltered } from '@/lib/quotationStore';
import { computeLeadStats } from '@/lib/leadStore';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager } from '@/lib/permissions';
import { listDepartmentManagers, isUserADepartmentManager } from '@/lib/departmentStore';
import { listTechnicalRoster } from '@/lib/technicalRoster';
import { needsFollowUp } from '@/lib/followUp';
import { isReminderDue } from '@/lib/siteVisitReminder';
import { summarizeMarketingReminders } from '@/lib/marketingRequestReminder';
import { projectHandoverStore } from '@/lib/projectHandoverStore';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { travelScheduleStore } from '@/lib/travelScheduleStore';

// Single round trip for everything Dashboard.tsx needs on first paint —
// replaces what used to be up to 13 separate client-side fetches (modules,
// projects/kpis, backoffice/kpis, admin/quotations, site-visits, leads/stats,
// marketing-requests/stats, projects, demo-schedule, departments/managers,
// technical-roster, quotations/mine, quotations/stats), each independently
// paying its own HTTP round trip AND its own getViewerContext resolution.
// Also collapses genuine duplicate underlying queries those routes used to
// run separately: projects/kpis internally re-fetched projects/site-visits/
// demos that the dashboard's own /api/projects, /api/site-visits, and
// /api/demo-schedule calls were fetching again in parallel — those are each
// fetched exactly once here and reused for every derived value.
//
// Visibility scoping is preserved exactly per source route, not unified —
// in particular, demo-schedule's list has two genuinely different scopes in
// the original routes (kpis used viewer.isPrivileged only; the dashboard's
// raw demos list used the broader canSeeQueue, which also includes
// technical/backoffice roles and department managers), so both are fetched
// distinctly rather than collapsed into one, to avoid silently changing
// either number.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const isBackOffice = viewer.role === 'backoffice' || viewer.isPrivileged;
    const isManagerTier = viewer.role === 'manager' || viewer.role === 'admin' || viewer.role === 'superadmin';

    const user = await findUserNameAndDeptByUsername(viewer.username);

    // canSeeQueue also gates backOfficeKpis below — isBackOffice (backoffice
    // role or privileged) always implies canSeeQueue, so demosForQueue is
    // already the right superset to reuse there without a second demo fetch.
    const [
      modules,
      projectsLight,
      siteVisits,
      demosForKpis,
      demosForQueue,
      leadStats,
      technicalRoster,
      managersByDepartment,
      quotationsForViewer,
      backOfficeDcs,
      marketingRecords
    ] = await Promise.all([
      listVisibleModules({ role: viewer.role, isPrivileged: viewer.isPrivileged, department: user?.department }),
      projectStore.listLight(viewer.username, viewer.isPrivileged),
      siteVisitStore.list(viewer.username, viewer.isPrivileged),
      demoScheduleStore.list(viewer.username, viewer.isPrivileged),
      (async () => {
        const canSeeQueue =
          viewer.isPrivileged || viewer.role === 'engineer' || viewer.role === 'backoffice' || (await isUserADepartmentManager(viewer.username));
        return demoScheduleStore.list(viewer.username, canSeeQueue);
      })(),
      computeLeadStats(viewer.username, viewer.isPrivileged),
      listTechnicalRoster(),
      listDepartmentManagers(),
      searchQuotationsFiltered({ viewerUsername: viewer.username }),
      isBackOffice ? deliveryChallanStore.list(viewer.username, true) : Promise.resolve(null),
      (async () => {
        const isReviewer = await isMarketingManager(viewer);
        return { isReviewer, records: await marketingRequestStore.list(viewer.username, isReviewer) };
      })()
    ]);

    // None of these three depend on each other — quotationsCount needs
    // projectsLight (already resolved above), pendingHandovers/travelRecords
    // need only the viewer — so they run together instead of as three more
    // sequential round trips (travelScheduleStore.list in particular is a
    // multi-join query, not cheap to pay for twice removed from parallel).
    const [quotationsCount, pendingHandovers, travelRecords] = await Promise.all([
      countQuotationsForProjects(projectsLight.map((p) => p.id)),
      projectHandoverStore.listPendingForUser(viewer.userId),
      travelScheduleStore.list(viewer.username, viewer.isPrivileged)
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const siteVisitsToday = siteVisits.filter((v) => v.visit_date === today).length;
    const nonFinalDemoStatuses = new Set(['pending_technical', 'pending_manager', 'pending_backoffice', 'dc_generated', 'material_dispatched']);
    const upcomingDemos = demosForKpis.filter((d) => nonFinalDemoStatuses.has(d.status) && d.scheduled_at && new Date(d.scheduled_at).getTime() > now).length;
    const pendingResponses = projectsLight.filter((p) => p.stage === 'customer_response').length;
    const negotiations = projectsLight.filter((p) => p.stage === 'negotiation').length;
    const wonDeals = projectsLight.filter((p) => p.status === 'won').length;
    const lostDeals = projectsLight.filter((p) => p.status === 'lost').length;
    const decided = wonDeals + lostDeals;
    const conversionRate = decided > 0 ? Math.round((wonDeals / decided) * 100) : 0;
    const upcomingSiteVisits = siteVisits.filter((v) => v.status === 'open').length;
    const pendingApprovals = demosForKpis.filter((d) => d.status === 'pending_technical' || d.status === 'pending_manager').length;
    const activeProjects = projectsLight.filter((p) => p.status === 'active').length;

    const kpis = {
      totalProjects: projectsLight.length,
      siteVisitsToday,
      quotationsSent: quotationsCount,
      upcomingDemos,
      pendingResponses,
      negotiations,
      wonDeals,
      lostDeals,
      conversionRate,
      upcomingSiteVisits,
      pendingApprovals,
      activeProjects
    };

    let backOfficeKpis: { pendingDc: number; pendingVerification: number; pendingDispatch: number } | null = null;
    if (backOfficeDcs) {
      // demosForQueue is already the canSeeQueue=true superset for any
      // isBackOffice viewer (see note above) — reused instead of a second
      // demo-schedule query.
      const dispatchedDemoIds = new Set(demosForQueue.filter((d) => d.status === 'demo_completed').map((d) => d.id));
      backOfficeKpis = {
        pendingDc: demosForQueue.filter((d) => d.status === 'pending_backoffice').length,
        pendingVerification: backOfficeDcs.filter((d) => d.status === 'dispatched' && dispatchedDemoIds.has(d.demo_id)).length,
        // A DC already created (manual or demo-linked) still sitting at
        // 'prepared', not yet dispatched — see app/api/backoffice/kpis's
        // same field for why this is distinct from pendingDc above.
        pendingDispatch: backOfficeDcs.filter((d) => d.status === 'prepared').length
      };
    }

    const followUpCount = viewer.isPrivileged ? quotationsForViewer.filter((r) => needsFollowUp(r)).length : null;
    const reminderCount = siteVisits.filter((v) => isReminderDue(v)).length;

    // Travel schedule attention counts (pendingHandovers/travelRecords fetched above)
    const isHrManager = (managersByDepartment['HR'] || []).some((m) => m.id === viewer.userId);
    const isAdminDeptManager = (managersByDepartment['Admin'] || managersByDepartment['Administration'] || []).some((m) => m.id === viewer.userId);
    const isAccountsDeptManager = (managersByDepartment['Accounts'] || []).some((m) => m.id === viewer.userId);

    let travelPendingCount = 0;
    for (const tr of travelRecords) {
      if (tr.status === 'submitted' && (isManagerTier || viewer.isPrivileged)) travelPendingCount++;
      else if (tr.status === 'manager_approved' && (isHrManager || viewer.isPrivileged)) travelPendingCount++;
      else if (tr.status === 'hr_reviewed' && (isAdminDeptManager || viewer.isPrivileged)) travelPendingCount++;
      else if (tr.status === 'admin_approved' && (isAccountsDeptManager || viewer.isPrivileged)) travelPendingCount++;
      else if (tr.status === 'ticket_booking' && (isHrManager || viewer.isPrivileged)) travelPendingCount++;
      else if (tr.status === 'changes_requested' && tr.created_by === viewer.username) travelPendingCount++;
    }

    const marketingStats = marketingRecords.isReviewer
      ? { isReviewer: true, awaitingReview: marketingRecords.records.filter((r) => r.status === 'submitted').length }
      : { isReviewer: false, myOpenCount: marketingRecords.records.filter((r) => ['submitted', 'timeline_set', 'in_progress'].includes(r.status)).length };
    const marketingReminderBreakdown = summarizeMarketingReminders(marketingRecords.records);
    const marketingReminderUrgentCount = marketingReminderBreakdown.due_today + marketingReminderBreakdown.overdue;

    let quotationStats: { total: number; draft: number; sent: number; approved: number; rejected: number; expired: number } | null = null;
    if (isManagerTier) {
      const rows = quotationsForViewer;
      const counts = { total: rows.length, draft: 0, sent: 0, approved: 0, rejected: 0, expired: 0 };
      for (const r of rows) {
        const status = computeEffectiveStatus(r);
        if (status === 'draft') counts.draft++;
        else if (status === 'sent') counts.sent++;
        else if (status === 'approved') counts.approved++;
        else if (status === 'rejected') counts.rejected++;
        else if (status === 'expired') counts.expired++;
      }
      quotationStats = counts;
    }

    // Rendered as the "Recent Quotations" 5-item card
    const recentQuotationsTrimmed = [...quotationsForViewer].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5);

    return NextResponse.json({
      modules,
      kpis,
      backOfficeKpis,
      followUpCount,
      reminderCount,
      unattendedLeads: leadStats.unattended,
      marketingStats,
      marketingReminderUrgentCount,
      allProjects: projectsLight,
      demos: demosForQueue,
      managersByDepartment,
      technicalRoster,
      recentQuotations: recentQuotationsTrimmed,
      quotationStats,
      pendingHandovers,
      travelPendingCount
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
