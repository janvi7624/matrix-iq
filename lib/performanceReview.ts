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
    leadStore.listOwnedBy(username),
    tmsTaskStore.listForAssignee(user.id)
  ]);

  const crm = {
    totalLeads: projects.length,
    qualifiedLeads: projects.filter((p) => p.stage !== 'cold_call' && p.stage !== 'catalogue_offered' && p.stage !== 'site_visit').length,
    lostLeads: projects.filter((p) => p.status === 'lost').length,
    wonLeads: projects.filter((p) => p.status === 'won').length,
    unattendedLeads: leads.filter(isLeadUnattended).length
  };

  const sales = {
    quotationsCreated: quotations.length,
    quotationsRevised: quotations.filter((q) => q.revision_number > 0).length,
    quotationsConverted: quotations.filter((q) => q.status === 'approved').length
  };

  const projectMetrics = {
    assignedProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === 'active').length,
    completedProjects: projects.filter((p) => p.stage === 'completed').length
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
    ...leads.map((l) => ({ at: l.created_at, action: `Lead captured — ${l.name || l.company}`, remarks: l.notes })),
    ...tasks.map((t) => ({ at: t.created_at, action: `Task ${t.status === 'completed' ? 'completed' : 'assigned'} — ${t.name}`, remarks: t.remarks }))
  ]
    .filter((t) => t.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 60);

  const activityDates = [...projects.map((p) => p.created_at), ...siteVisits.map((v) => v.created_at), ...quotations.map((q) => q.created_at), ...demos.map((d) => d.created_at)];

  // Lightweight project index for a click-through drill-down (name + id +
  // status only) — the full ProjectRecord carries notes/timeline/etc. that a
  // drill-down list has no use for and shouldn't need to transfer.
  const projectsList = projects
    .map((p) => ({ id: p.id, label: p.client_name || p.company || `Project ${p.id}`, stage: p.stage, status: p.status }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));

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
    timeline,
    charts: {
      weekly: buildSeries(activityDates, 'week', 12),
      monthly: buildSeries(activityDates, 'month', 12),
      yearly: buildSeries(activityDates, 'year', 5)
    }
  };
}
