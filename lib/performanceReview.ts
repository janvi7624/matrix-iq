import { findUserByUsername } from './userStore';
import { projectStore } from './projectStore';
import { siteVisitStore } from './siteVisitStore';
import { demoScheduleStore } from './demoScheduleStore';
import { customerResponseStore } from './customerResponseStore';
import { deliveryChallanStore } from './deliveryChallanStore';
import { searchQuotationsFiltered } from './quotationStore';
import { leadStore } from './leadStore';
import { tmsTaskStore } from './tmsTaskStore';
import { isLeadUnattended, needsFollowUp, parseFollowUpNotes } from './followUp';
import { computeLeadCallStats } from './leadCall';
import { ProjectTimelineEvent } from './types';

interface TimelineItem {
  at: string;
  action: string;
  remarks: string;
}

function bucketKey(iso: string, granularity: 'week' | 'month' | 'year'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  if (granularity === 'year') return String(d.getFullYear());
  if (granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  // ISO week-ish: year + week number (Sun-based, good enough for a trend chart, not for payroll)
  const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - firstDayOfYear.getTime()) / 86400000 + firstDayOfYear.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function buildSeries(dates: string[], granularity: 'week' | 'month' | 'year', limit: number): { bucket: string; count: number }[] {
  const counts = new Map<string, number>();
  dates.forEach((d) => {
    const key = bucketKey(d, granularity);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-limit)
    .map(([bucket, count]) => ({ bucket, count }));
}

export type PerformanceReview = Awaited<ReturnType<typeof buildPerformanceReview>>;

// One employee's activity aggregated across every module — originally built
// for the Performance Review admin page (app/api/admin/performance-review/
// [username]/route.ts), extracted here so the Person Performance Dashboard
// drill-down (app/api/dashboard/person/[username]/route.ts) can show the
// same real data without duplicating the fetch/aggregation logic. Pure data
// assembly only — each caller is responsible for its own authorization
// before calling this.
export async function buildPerformanceReview(username: string) {
  const user = await findUserByUsername(username);
  if (!user) return null;

  const [projects, siteVisits, demos, responses, deliveryChallans, quotations, leads, tasks] = await Promise.all([
    projectStore.listOwnedBy(username),
    siteVisitStore.listOwnedBy(username),
    demoScheduleStore.list(username, false),
    customerResponseStore.list(username, false),
    deliveryChallanStore.listOwnedBy(username),
    searchQuotationsFiltered({ ownerUsername: username }),
    // list() (this person's own visibility scope), not listOwnedBy(): the CRM
    // metrics below are keyed on the ASSIGNEE — the person actually asked to
    // ring the card — and listOwnedBy only knows created_by. Both subsets are
    // filtered back to strictly this person below, so nothing balloons to a
    // department manager's whole team the way a raw list() would.
    leadStore.list(username, false),
    tmsTaskStore.listForAssignee(user.id)
  ]);

  // Leads this person captured (their own scanning/import activity) vs leads
  // routed to them to work — two different numbers that used to be the same
  // one, which is how a single 600-card expo import made one employee look
  // responsible for the entire unattended pile.
  const capturedLeads = leads.filter((l) => l.created_by === username);
  const assignedLeads = leads.filter((l) => l.assigned_to === username);

  // The CRM group counts LEADS now, not projects. It used to read off
  // projectStore, which was only ever a proxy for leads because assigning a
  // lead created a project — that's exactly what the expo broke, and a
  // project now exists only once a call said the lead was worth one. Same
  // funnel the Leads page tiles show (lib/leadCall.ts), so the two agree.
  const callStats = computeLeadCallStats(assignedLeads);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const crm = {
    // 'Total Leads' — routed to this person to work.
    totalLeads: assignedLeads.length,
    // 'Qualified Leads' — the call said suitable (the only path to a project).
    qualifiedLeads: callStats.suitable,
    // 'Lost Leads' — ruled out on the call: stays a contact, never a project.
    lostLeads: callStats.notSuitable,
    // 'Won Leads' — qualified AND the project it became was won. No extra
    // query needed: createProjectFromLead attributes the project to the
    // assignee, so it's already in `projects`.
    wonLeads: assignedLeads.filter((l) => l.project_id && projectById.get(l.project_id)?.status === 'won').length,
    calledLeads: assignedLeads.filter((l) => !!l.called_at).length,
    // Assigned, never called, no project — the rep's actual call queue.
    awaitingCallLeads: callStats.toCall,
    callbacksDue: callStats.callbackDue,
    unattendedLeads: assignedLeads.filter(isLeadUnattended).length,
    capturedLeads: capturedLeads.length
  };

  const sales = {
    quotationsCreated: quotations.length,
    quotationsRevised: quotations.filter((q) => q.revision_number > 0).length,
    quotationsConverted: quotations.filter((q) => q.status === 'approved').length
  };

  const projectMetrics = {
    assignedProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === 'active').length,
    // stage === 'completed' is retired from Project Progress (management
    // decision, 2026-09) and never set going forward — status === 'won' is
    // now the closest available "done" signal.
    completedProjects: projects.filter((p) => p.status === 'won').length,
    // Project win/loss lives here rather than under `crm`, which is lead
    // data now — the Person Performance Dashboard's "Won / Lost" tile sits
    // in its Projects section and reads these.
    wonProjects: projects.filter((p) => p.status === 'won').length,
    lostProjects: projects.filter((p) => p.status === 'lost').length
  };

  const demoMetrics = {
    scheduled: demos.filter((d) => d.status !== 'cancelled' && d.status !== 'demo_completed').length,
    completed: demos.filter((d) => d.status === 'demo_completed').length,
    cancelled: demos.filter((d) => d.status === 'cancelled').length
  };

  let followUpPending = 0;
  let followUpCompleted = 0;
  let followUpOverdue = 0;
  quotations.forEach((q) => {
    const hasNotes = parseFollowUpNotes(q.follow_up_notes_json).length > 0;
    if (needsFollowUp(q)) followUpOverdue += 1;
    else if (hasNotes) followUpCompleted += 1;
    else followUpPending += 1;
  });

  const dc = {
    pending: deliveryChallans.filter((d) => d.status !== 'closed').length,
    closed: deliveryChallans.filter((d) => d.status === 'closed').length
  };

  const customerResponse = {
    positive: responses.filter((r) => r.response_type === 'interested').length,
    negative: responses.filter((r) => r.response_type === 'not_interested' || r.response_type === 'budget_issue' || r.response_type === 'competitor').length,
    pending: responses.filter((r) => r.response_type === '').length
  };

  const taskMetrics = {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    pending: tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length
  };

  // Timeline — every project-stage event this user logged, across every
  // project they own, plus the top-level "created X" moments for the
  // other modules, newest first.
  const timeline: TimelineItem[] = [
    ...projects.flatMap((p) => p.timeline.filter((t: ProjectTimelineEvent) => t.by === username).map((t) => ({ at: t.at, action: t.label, remarks: t.remarks }))),
    ...siteVisits.map((v) => ({ at: v.created_at, action: `Site visit logged — ${v.company_name || v.location}`, remarks: v.purpose })),
    ...quotations.map((q) => ({ at: q.created_at, action: `Quotation ${q.quotation_number} created`, remarks: q.products_summary })),
    ...demos.map((d) => ({ at: d.created_at, action: `Demo requested — ${d.client_name || d.company}`, remarks: d.notes })),
    ...responses.map((r) => ({ at: r.created_at, action: 'Customer response logged', remarks: r.feedback })),
    ...deliveryChallans.map((d) => ({ at: d.created_at, action: `Delivery Challan ${d.dc_number} created`, remarks: '' })),
    ...capturedLeads.map((l) => ({ at: l.created_at, action: `Lead captured — ${l.name || l.company}`, remarks: l.notes })),
    // The qualification call is the step that decides whether a card becomes
    // a project at all (lib/leadCall.ts), so it belongs on the timeline —
    // keyed on who made the call, which is not always the assignee.
    ...leads
      .filter((l) => l.called_at && l.called_by_id === user.id)
      .map((l) => ({ at: l.called_at, action: `Lead call — ${l.name || l.company} (${l.call_outcome.replace('_', ' ')})`, remarks: l.call_remark })),
    ...tasks.map((t) => ({ at: t.created_at, action: `Task ${t.status === 'completed' ? 'completed' : 'assigned'} — ${t.name}`, remarks: t.remarks }))
  ]
    .filter((t) => t.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 60);

  // Qualification calls count as activity. They didn't need to before,
  // because assigning a lead created a project and the project's created_at
  // stood in for the work — now most assigned leads never become a project,
  // so without this a rep who spent the week on the phone would show an
  // empty activity chart.
  const activityDates = [
    ...projects.map((p) => p.created_at),
    ...siteVisits.map((v) => v.created_at),
    ...quotations.map((q) => q.created_at),
    ...demos.map((d) => d.created_at),
    ...leads.filter((l) => l.called_at && l.called_by_id === user.id).map((l) => l.called_at)
  ];

  // Lightweight project index for a click-through drill-down (name + id +
  // status only) — the full ProjectRecord carries notes/timeline/etc. that a
  // drill-down list has no use for and shouldn't need to transfer.
  const projectsList = projects
    .map((p) => ({ id: p.id, label: p.client_name || p.company || `Project ${p.id}`, stage: p.stage, status: p.status }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));

  // Same idea for TMS tasks — the Person Performance Dashboard's Tasks tiles
  // used to be totals with nothing to click through to.
  const tasksList = tasks
    .map((t) => ({ id: t.id, label: t.name, status: t.status, dueDate: t.due_date, projectName: t.project_name }))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  return {
    user: { username: user.username, name: user.name, department: user.department, designation: user.designation, employeeId: user.employeeId, joiningDate: user.createdAt, role: user.role },
    crm,
    sales,
    projects: projectMetrics,
    projectsList,
    siteVisits: { total: siteVisits.length },
    demo: demoMetrics,
    followUps: { pending: followUpPending, completed: followUpCompleted, overdue: followUpOverdue },
    dc,
    customerResponse,
    tasks: taskMetrics,
    tasksList,
    timeline,
    charts: {
      weekly: buildSeries(activityDates, 'week', 12),
      monthly: buildSeries(activityDates, 'month', 12),
      yearly: buildSeries(activityDates, 'year', 5)
    }
  };
}
