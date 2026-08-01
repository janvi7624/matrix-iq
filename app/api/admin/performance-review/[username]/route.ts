import { NextRequest, NextResponse } from 'next/server';
import { findUserByUsername } from '@/lib/userStore';
import { projectStore } from '@/lib/projectStore';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { customerResponseStore } from '@/lib/customerResponseStore';
import { deliveryChallanStore } from '@/lib/deliveryChallanStore';
import { searchQuotationsFiltered } from '@/lib/quotationStore';
import { leadStore } from '@/lib/leadStore';
import { isLeadUnattended, needsFollowUp, parseFollowUpNotes } from '@/lib/followUp';
import { apiErrorResponse } from '@/lib/apiError';
import { ProjectTimelineEvent } from '@/lib/types';

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

// Aggregates one employee's activity across every module for the
// Performance Review dashboard (section 23) — same "read every relevant
// store scoped to this one user" shape as
// app/api/admin/users/[id]/activity/route.ts, just wider. Route access
// (Super Admin/Admin/Manager only) is enforced by proxy.ts's /api/admin/*
// privileged gate — no extra check needed here.
export async function GET(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  try {
    const user = await findUserByUsername(username);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const [projects, siteVisits, demos, responses, deliveryChallans, quotations, leads] = await Promise.all([
      projectStore.list(username, false),
      siteVisitStore.list(username, false),
      demoScheduleStore.list(username, false),
      customerResponseStore.list(username, false),
      deliveryChallanStore.list(username, false),
      searchQuotationsFiltered({ ownerUsername: username }),
      leadStore.list(username, false)
    ]);

    const crm = {
      totalLeads: projects.length,
      qualifiedLeads: projects.filter((p) => p.stage !== 'site_visit').length,
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
      ...leads.map((l) => ({ at: l.created_at, action: `Lead captured — ${l.name || l.company}`, remarks: l.notes }))
    ]
      .filter((t) => t.at)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 60);

    const activityDates = [...projects.map((p) => p.created_at), ...siteVisits.map((v) => v.created_at), ...quotations.map((q) => q.created_at), ...demos.map((d) => d.created_at)];

    return NextResponse.json({
      user: { username: user.username, name: user.name, department: user.department, designation: user.designation, employeeId: user.employeeId, joiningDate: user.createdAt, role: user.role },
      crm,
      sales,
      projects: projectMetrics,
      siteVisits: { total: siteVisits.length },
      demo: demoMetrics,
      followUps: { pending: followUpPending, completed: followUpCompleted, overdue: followUpOverdue },
      dc,
      customerResponse,
      timeline,
      charts: {
        weekly: buildSeries(activityDates, 'week', 12),
        monthly: buildSeries(activityDates, 'month', 12),
        yearly: buildSeries(activityDates, 'year', 5)
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
