import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { listVisibleModules, isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { buildMyDailyReportStatus, buildDailyReportAdminBrief } from '@/lib/dailyReportService';
import { buildMyTargetSummary } from '@/lib/myTargetSummary';
import { getUpcomingCelebrations } from '@/lib/celebrationStore';
import { projectStore } from '@/lib/projectStore';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { deliveryChallanStore } from '@/lib/deliveryChallanStore';
import { countQuotationsForProjects, computeEffectiveStatus, searchQuotationsFiltered } from '@/lib/quotationStore';
import { leadStore } from '@/lib/leadStore';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { hasCapability, isMarketingManager } from '@/lib/permissions';
import { listDepartmentManagers, isUserADepartmentManager } from '@/lib/departmentStore';
import { needsFollowUp, isLeadUnattended } from '@/lib/followUp';
import { isReminderDue } from '@/lib/siteVisitReminder';
import { summarizeMarketingReminders } from '@/lib/marketingRequestReminder';
import { projectHandoverStore } from '@/lib/projectHandoverStore';
import { listTechnicalRequestsAwaiting } from '@/lib/projectTechnicalRequest';
import { findUserNameAndDeptByUsername, findUsersByIds } from '@/lib/userStore';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { listSalesTeamRoster } from '@/lib/targetAccess';
import { buildSalesTeamSummary, isSalesLeadership, SalesTeamSummaryRow } from '@/lib/salesTeamSummary';
import { buildDepartmentBreakdown } from '@/lib/projectDepartmentOptions';

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
//
// Also now folds in the four small per-viewer widgets Dashboard.tsx used to
// fetch as their OWN separate round trips (My Target, the all-departments
// Daily Report brief, "have I filed today", upcoming birthdays/
// anniversaries) — each kept as its own standalone endpoint too (see
// app/api/targets/me, app/api/dashboard/daily-report-brief,
// app/api/hr-dashboard) for any other caller, both now thin wrappers around
// the same shared lib function this route calls directly. Each is
// `.catch(() => null)`-guarded independently, same "a failure here must
// only hide the shortcut, never break the dashboard" rule the ORIGINAL
// separate requests already relied on (see the removed useEffect in
// Dashboard.tsx) — one of these throwing must not 500 the whole page.
//
// Deliberately NOT folded in: /api/dashboard/health (its own TTL cache
// shared across concurrent viewers, on a slower independent refresh
// cadence — merging would force it onto this route's faster cadence and
// multiply its already-expensive per-department scoring) and
// /api/dashboard/celebrations (fires the day's celebration emails exactly
// once per mount; this route's data is also polled every 60s by
// useAutoRefresh, and folding it in would re-run that side effect on every
// poll instead of once per page load).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const isBackOffice = viewer.role === 'backoffice' || viewer.isPrivileged;
    const isManagerTier = viewer.role === 'manager' || viewer.role === 'admin' || viewer.role === 'superadmin';

    // isDeptManager resolved up front — needed both for canSeeQueue below and
    // for listVisibleModules's team-tasks visibility, and this way it's only
    // looked up once instead of twice. seesOrgWide joins them rather than
    // being awaited on its own later: it reads the cached roles list, and
    // isSalesLeadership() below needs it before the roster fetch is queued.
    const [user, isDeptManager, seesOrgWide] = await Promise.all([
      findUserNameAndDeptByUsername(viewer.username),
      isUserADepartmentManager(viewer.username),
      hasCapability(viewer.role, 'viewAllDepartments')
    ]);
    const canSeeQueue = viewer.isPrivileged || viewer.role === 'engineer' || viewer.role === 'backoffice' || isDeptManager;
    const viewerForModules = { role: viewer.role, username: viewer.username, isPrivileged: viewer.isPrivileged, department: user?.department, isDepartmentManager: isDeptManager };
    // Reads the already-cached module list resolved by listVisibleModules
    // below — gates dailyReportStatus the same way the standalone
    // app/api/daily-reports/me/status route's guardDailyReport does, just
    // degrading to null instead of a 403 (this route must never fail whole).
    const canSeeDailyReport = await isModuleAccessAllowed('daily-report', viewerForModules);

    // canSeeQueue also gates backOfficeKpis below — isBackOffice (backoffice
    // role or privileged) always implies canSeeQueue, so demosForQueue is
    // already the right superset to reuse there without a second demo fetch.
    const [
      modules,
      projectsLight,
      siteVisits,
      demosForKpis,
      demosForQueue,
      leads,
      managersByDepartment,
      quotationsForViewer,
      backOfficeDcs,
      marketingRecords,
      myTarget,
      upcomingCelebrations,
      dailyReportStatus,
      dailyReportBrief
    ] = await Promise.all([
      listVisibleModules(viewerForModules),
      projectStore.listLight(viewer.username, viewer.isPrivileged),
      siteVisitStore.list(viewer.username, viewer.isPrivileged),
      demoScheduleStore.list(viewer.username, viewer.isPrivileged),
      demoScheduleStore.list(viewer.username, canSeeQueue),
      // The lead list rather than computeLeadStats: same single query that
      // helper runs internally, but "Needs Your Attention" is a personal
      // queue, so the unattended count below has to be scoped to leads
      // assigned to THIS viewer — a department-wide total isn't something
      // they can act on, and the helper only offers the wider figure.
      leadStore.list(viewer.username, viewer.isPrivileged),
      listDepartmentManagers(),
      searchQuotationsFiltered({ viewerUsername: viewer.username }),
      isBackOffice ? deliveryChallanStore.list(viewer.username, true) : Promise.resolve(null),
      (async () => {
        const isReviewer = await isMarketingManager(viewer);
        return { isReviewer, records: await marketingRequestStore.list(viewer.username, isReviewer) };
      })(),
      buildMyTargetSummary(viewer.userId, viewer.username).catch(() => null),
      getUpcomingCelebrations().catch(() => null),
      canSeeDailyReport ? buildMyDailyReportStatus(viewer.userId).catch(() => null) : Promise.resolve(null),
      seesOrgWide ? buildDailyReportAdminBrief().catch(() => null) : Promise.resolve(null)
    ]);

    // Sales Manager / Admin / Super Admin only — see lib/salesTeamSummary.ts
    // for why this is a positive Sales-side check rather than canManageTargets.
    // Resolved from data already in hand (no extra query), and it gates both
    // of this viewer's Dashboard differences: the pending/due split of the
    // attention panel, and the Sales Team Summary table.
    const salesLeadership = isSalesLeadership({
      role: viewer.role,
      username: viewer.username,
      department: user?.department ?? '',
      seesOrgWide,
      managersByDepartment
    });

    // None of these depend on each other — quotationsCount needs
    // projectsLight (already resolved above), pendingHandovers/travelRecords/
    // salesRoster need only the viewer — so they run together instead of as
    // four more sequential round trips (travelScheduleStore.list in
    // particular is a multi-join query, not cheap to pay for twice removed
    // from parallel).
    const [quotationsCount, pendingHandovers, travelRecords, pendingTechnicalApprovals, salesRoster] = await Promise.all([
      countQuotationsForProjects(projectsLight.map((p) => p.id)),
      projectHandoverStore.listPendingForUser(viewer.userId),
      travelScheduleStore.list(viewer.username, viewer.isPrivileged),
      // Technical-person requests waiting on this viewer, as the engineer or
      // their department manager (lib/projectTechnicalRequest.ts).
      listTechnicalRequestsAwaiting(viewer),
      // The only query the Sales Team Summary costs — its leads/projects/
      // quotations columns are all derived from rows already fetched above.
      salesLeadership ? listSalesTeamRoster(viewer.username) : Promise.resolve(null)
    ]);

    const salesTeamSummary: SalesTeamSummaryRow[] | null = salesRoster
      ? buildSalesTeamSummary(salesRoster, leads, projectsLight, quotationsForViewer)
      : null;

    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const siteVisitsToday = siteVisits.filter((v) => v.visit_date === today).length;
    const nonFinalDemoStatuses = new Set(['pending_technical', 'pending_manager', 'pending_backoffice', 'ready_for_demo', 'dc_generated', 'material_dispatched']);
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
    // Lead -> Project automation — projectsLight is already scoped to what
    // this viewer can see (their own projects, per resolveOwnerWhere), so an
    // auto-created project (created_by = the assignee) is already in this
    // set with no extra query needed.
    // Split in two, because the two facts are different and both matter.
    //
    // MINE is what the viewer can actually act on — only a project's creator
    // is shown the confirm banner (components/ProjectDetailView.tsx). The
    // attention item saying "awaiting YOUR confirmation" must count this.
    //
    // TEAM is everything else pending in their scope. It used to be folded
    // into the same number, which told a manager 19 were waiting on them
    // when none were. Dropping it entirely was worse — they lost sight of a
    // real backlog — so it is reported separately and labelled honestly.
    const pendingConfirmationAll = projectsLight.filter((p) => p.lead_confirmation_status === 'pending_confirmation');
    const pendingProjectConfirmations = pendingConfirmationAll.filter((p) => p.created_by === viewer.username).length;
    const pendingProjectConfirmationsTeam = pendingConfirmationAll.length - pendingProjectConfirmations;

    // The rep's call queue: leads handed to this viewer that still have no
    // call logged against them after the SLA (lib/followUp.ts). Deliberately
    // assignee-scoped — the Dashboard row it feeds says "assigned to you",
    // and a lead sitting on a colleague's desk isn't this viewer's to chase.
    const unattendedLeads = leads.filter((l) => l.assigned_to === viewer.username && isLeadUnattended(l)).length;
    // Same local-date comparison computeLeadStats used for this figure, so
    // the Dashboard's "New Meta leads today" and the Leads page tile agree.
    const todayStr = new Date().toDateString();
    const metaLeadsToday = leads.filter((l) => l.source === 'meta_lead_ads' && new Date(l.created_at).toDateString() === todayStr).length;

    // The four figures the Dashboard's headline cards show. Every one is
    // counted from a list ALREADY fetched above for other purposes — no new
    // query, and no derived "trend" against a prior period, because nothing
    // here stores a historical snapshot to compare against. A made-up
    // "+12% vs last month" on a CRM dashboard is worse than no trend at all.
    //
    // Both lists are the viewer's own visibility scope (leadStore.list and
    // searchQuotationsFiltered both take the viewer), so these totals mean
    // "what you can see", consistent with every other figure on the page.
    const headlineKpis = {
      totalLeads: leads.length,
      totalQuotations: quotationsForViewer.length,
      totalQuotationValue: quotationsForViewer.reduce((sum, q) => sum + (Number(q.total) || 0), 0)
    };

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

    // The "Projects by Department" card, counted here rather than in the
    // browser. Sending projectsLight so the client could count it was 483 kB
    // of a 522 kB response — 93% — and these few numbers were nearly all it
    // did with them. See buildDepartmentBreakdown.
    const departmentBreakdown = buildDepartmentBreakdown(projectsLight);

    // The department of whoever each queued demo is assigned to — the only
    // thing the dashboard ever did with the technical roster, which it used
    // to fetch in full.
    //
    // listTechnicalRoster() runs four queries to rank every technical person
    // by workload, and measured 346 ms — the slowest read on this route, so
    // it set the floor for the whole dashboard. The dashboard used none of
    // the ranking: it built an id -> department map and looked up at most a
    // handful of demo assignees. This is that map, for exactly those ids.
    const demoAssigneeIds = [...new Set(demosForQueue.map((d) => d.assigned_technical_person_id).filter((id): id is string => !!id))];
    const demoAssigneeDepartments: Record<string, string> = {};
    if (demoAssigneeIds.length) {
      for (const user of await findUsersByIds(demoAssigneeIds)) {
        demoAssigneeDepartments[user.id] = user.department ?? '';
      }
    }

    return NextResponse.json({
      modules,
      kpis,
      headlineKpis,
      backOfficeKpis,
      followUpCount,
      reminderCount,
      pendingProjectConfirmations,
      pendingProjectConfirmationsTeam,
      unattendedLeads,
      metaLeadsToday,
      marketingStats,
      marketingReminderUrgentCount,
      // allProjects and recentQuotations are deliberately NOT returned.
      // The panels that used them (Recent Projects, Recent Quotations,
      // Projects Assigned to You) were removed from the dashboard, and the
      // only survivor — the per-department card — is counted above. The
      // drill-down modal loads projects when somebody opens it.
      departmentBreakdown,
      demos: demosForQueue,
      managersByDepartment,
      demoAssigneeDepartments,
      quotationStats,
      pendingHandovers,
      pendingTechnicalApprovals,
      travelPendingCount,
      salesLeadership,
      salesTeamSummary,
      myTarget,
      upcomingCelebrations,
      dailyReportStatus,
      dailyReportBrief
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
