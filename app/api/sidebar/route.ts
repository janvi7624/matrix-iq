import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';
import { leadStore } from '@/lib/leadStore';
import { isLeadUnattended } from '@/lib/followUp';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager, canAssignLeads } from '@/lib/permissions';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { deliveryChallanStore } from '@/lib/deliveryChallanStore';
import { listVisibleModules } from '@/lib/moduleConfigStore';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { marketingReminderBand } from '@/lib/marketingRequestReminder';

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

    // Fetched together up front: listVisibleModules (below) needs deptManagers
    // resolved into a boolean BEFORE it's called (team-tasks visibility), and
    // the travel-schedule badge logic further down already needed deptManagers
    // anyway — resolving it here once avoids fetching it a second time there.
    const [user, deptManagers] = await Promise.all([findUserNameAndDeptByUsername(viewer.username), listDepartmentManagers()]);
    const isDeptManager = Object.values(deptManagers).some((list) => list.some((m) => m.username === viewer.username));

    const [modules, leads, canAssign, isMarketingReviewer, demosForBadge, backOfficeCounts] = await Promise.all([
      listVisibleModules({ role: viewer.role, isPrivileged: viewer.isPrivileged, department: user?.department, isDepartmentManager: isDeptManager }),
      // The lead list itself rather than computeLeadStats — same single query
      // that helper runs internally, but the badge below needs two counts it
      // doesn't expose (this viewer's OWN unattended leads, not their whole
      // department's), so counting here costs nothing extra.
      leadStore.list(viewer.username, viewer.isPrivileged),
      canAssignLeads(viewer),
      isMarketingManager(viewer),
      viewer.role === 'engineer' || isManagerTier ? demoScheduleStore.list(viewer.username, viewer.isPrivileged) : Promise.resolve(null),
      isBackOffice
        ? Promise.all([deliveryChallanStore.list(viewer.username, true), demoScheduleStore.list(viewer.username, true)])
        : Promise.resolve(null)
    ]);

    const badges: Record<string, number> = {};
    // One Leads badge, two different jobs, because two different people read
    // it. For a rep it's the calls they owe: leads handed to them that nobody
    // has rung within the SLA (lib/followUp.ts's isLeadUnattended — scoped to
    // leads assigned to THIS viewer, not every unattended lead in their
    // department, which is somebody else's queue and not actionable here).
    // For whoever routes leads it's the cards still sitting unassigned —
    // that's their backlog, and it's invisible to the unattended rule by
    // design, since nobody has been asked to do anything with them yet.
    // The two sets can't overlap (an unassigned lead is never unattended), so
    // a sales manager who also works leads gets both added, not double-counted.
    const myUnattendedLeads = leads.filter((l) => l.assigned_to === viewer.username && isLeadUnattended(l)).length;
    const unassignedLeads = canAssign ? leads.filter((l) => !l.assigned_to_id).length : 0;
    if (myUnattendedLeads + unassignedLeads) badges.leads = myUnattendedLeads + unassignedLeads;

    // marketingRecords needs isMarketingReviewer (resolved above); travelRecords
    // and deptManagers don't depend on anything from the first batch — all
    // three are independent of each other, so they run together instead of as
    // three more sequential round trips on an endpoint that fires on every page.
    const [marketingRecords, travelRecords] = await Promise.all([
      marketingRequestStore.list(viewer.username, isMarketingReviewer),
      travelScheduleStore.list(viewer.username, isPrivileged)
    ]);
    // Sums two different concerns into one nav badge — a reviewer's approval
    // backlog, and anyone's own requests crossing into due-today/overdue —
    // both worth surfacing, neither replacing the other.
    const awaitingReview = isMarketingReviewer ? marketingRecords.filter((r) => r.status === 'submitted').length : 0;
    const dueOrOverdue = marketingRecords.filter((r) => {
      const band = marketingReminderBand(r);
      return band === 'due_today' || band === 'overdue';
    }).length;
    if (awaitingReview + dueOrOverdue) badges['marketing-requests'] = awaitingReview + dueOrOverdue;

    if (demosForBadge) {
      const pendingApprovals = demosForBadge.filter((d) => d.status === 'pending_technical' || d.status === 'pending_manager').length;
      if (pendingApprovals) badges['demo-schedule'] = pendingApprovals;
    }

    if (backOfficeCounts) {
      const [dcs, backOfficeDemos] = backOfficeCounts;
      const dispatchedDemoIds = new Set(backOfficeDemos.filter((d) => d.status === 'demo_completed').map((d) => d.id));
      const pendingDc = backOfficeDemos.filter((d) => d.status === 'pending_backoffice').length;
      const pendingVerification = dcs.filter((d) => d.status === 'dispatched' && dispatchedDemoIds.has(d.demo_id)).length;
      const pendingDispatch = dcs.filter((d) => d.status === 'prepared').length;
      const count = pendingDc + pendingVerification + pendingDispatch;
      if (count) badges.backoffice = count;
    }

    // Travel schedule badge (travelRecords/deptManagers fetched above)
    const isHrMgr = (deptManagers['HR'] || []).some((m) => m.username === viewer.username);
    const isAdminMgr = (deptManagers['Admin'] || deptManagers['Administration'] || []).some((m) => m.username === viewer.username);
    const isAccountsMgr = (deptManagers['Accounts'] || []).some((m) => m.username === viewer.username);
    let travelBadge = 0;
    for (const tr of travelRecords) {
      if (tr.status === 'submitted' && (isManagerTier || isPrivileged)) travelBadge++;
      else if (tr.status === 'manager_approved' && (isHrMgr || isPrivileged)) travelBadge++;
      else if (tr.status === 'hr_reviewed' && (isAdminMgr || isPrivileged)) travelBadge++;
      else if (tr.status === 'admin_approved' && (isAccountsMgr || isPrivileged)) travelBadge++;
      else if (tr.status === 'ticket_booking' && (isHrMgr || isPrivileged)) travelBadge++;
      else if (tr.status === 'changes_requested' && tr.created_by === viewer.username) travelBadge++;
    }
    if (travelBadge) badges['travel-schedule'] = travelBadge;

    return NextResponse.json({
      modules,
      viewer: user ? { username: viewer.username, name: user.name, role: viewer.role, department: user.department } : null,
      badges
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
