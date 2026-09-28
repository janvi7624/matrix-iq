import { LeadRecord, ProjectRecord, QuotationRecord } from './types';
import { SALES_DEPARTMENTS } from './technicalRoles';

// Plain data/helpers only — no db import, so the Dashboard client component
// can pull the SalesTeamSummaryRow type straight out of here.

// Manager / Admin / Super Admin on the SALES side get a reshaped Dashboard
// top row: "Needs Your Attention" narrowed to requests actually pending
// someone's decision, everything date-driven split out into its own "Due"
// panel, and the Recent Projects / Recent Quotations cards replaced by the
// Sales Team Summary table.
//
// Deliberately NOT lib/targetAccess.ts's canManageTargets, close as the
// question is: that helper ends in `if (viewer.isPrivileged) return true`,
// and the seeded `manager` role IS isPrivileged (lib/roleStore.ts's
// SEED_ROLES) — reusing it would hand this Sales layout to an HR or
// Technical manager as well. Sales-side membership has to be established
// positively here: org-wide visibility (Admin / Super Admin), the viewer's
// own department, or Department Master listing them as a manager of one.
const SALES_LEADERSHIP_ROLES = ['manager', 'admin', 'superadmin'];

export function isSalesLeadership(input: {
  role: string;
  username: string;
  department: string;
  // hasCapability(role, 'viewAllDepartments') — resolved by the caller,
  // which keeps this function free of a db import.
  seesOrgWide: boolean;
  managersByDepartment: Record<string, { username: string }[]>;
}): boolean {
  if (!SALES_LEADERSHIP_ROLES.includes(input.role)) return false;
  if (input.seesOrgWide) return true;
  if (SALES_DEPARTMENTS.includes(input.department)) return true;
  return SALES_DEPARTMENTS.some((name) => (input.managersByDepartment[name] || []).some((m) => m.username === input.username));
}

// One row per member of the Sales roster, reading left to right as the
// funnel they actually work: Lead -> Enquiry -> Quotation -> Billing ->
// Won/Lost.
export interface SalesTeamSummaryRow {
  id: string;
  username: string;
  name: string;
  leads: number;
  enquiries: number;
  quotations: number;
  billing: number;
  won: number;
  lost: number;
}

// Built entirely from rows the Dashboard route has already fetched for its
// other numbers (leads, projects, quotations) — no query of its own beyond
// the roster, in keeping with that route's one-round-trip design. Every
// collection is walked once and credited through a username map, rather than
// re-filtering all three per member.
//
// Scope is inherited, not re-derived: the roster is already clamped to the
// viewer's visibility scope by listSalesTeamRoster, and nothing outside it
// can be credited, so a department-scoped Sales manager only ever sees their
// own team's figures here.
export function buildSalesTeamSummary(
  roster: { id: string; username: string; name: string }[],
  leads: Pick<LeadRecord, 'created_by' | 'assigned_to'>[],
  projects: Pick<ProjectRecord, 'id' | 'created_by' | 'status'>[],
  quotations: Pick<QuotationRecord, 'created_by' | 'status' | 'project_id' | 'total'>[]
): SalesTeamSummaryRow[] {
  const byUsername = new Map<string, SalesTeamSummaryRow>();
  const rows: SalesTeamSummaryRow[] = roster.map((member) => {
    const row: SalesTeamSummaryRow = {
      id: member.id,
      username: member.username,
      name: member.name || member.username,
      leads: 0,
      enquiries: 0,
      quotations: 0,
      billing: 0,
      won: 0,
      lost: 0
    };
    byUsername.set(member.username, row);
    return row;
  });
  if (!rows.length) return rows;

  // Lead: whose desk the lead is on — its assignee, falling back to whoever
  // captured it while it's still unassigned. Same attribution
  // computeMetaLeadAnalytics uses for its per-user breakdown, so the two
  // never disagree about who a lead belongs to.
  for (const lead of leads) {
    const row = byUsername.get(lead.assigned_to || lead.created_by);
    if (row) row.leads += 1;
  }

  // Enquiry: a Project row — what a lead is promoted into once it's a real
  // opportunity. Credited to created_by, which IS a sales project's sales
  // person (see lib/projectSalesOwner.ts's header: the sales_person column
  // is only a label). Won/Lost come off the same pass.
  const wonProjectIds = new Set<string>();
  for (const project of projects) {
    if (project.status === 'won') wonProjectIds.add(project.id);
    const row = byUsername.get(project.created_by);
    if (!row) continue;
    row.enquiries += 1;
    if (project.status === 'won') row.won += 1;
    else if (project.status === 'lost') row.lost += 1;
  }

  // Billing: lib/salesAchievement.ts's qualifying rule re-applied to rows
  // already in memory rather than paid for as a second query — an approved
  // quotation, attached to a project, where that project is won. Same
  // created_by attribution that file uses, so a person's Billing here and
  // their achievement under Target Details agree. Unbounded by period on
  // purpose: this is a standing team summary, not a target window.
  for (const quotation of quotations) {
    const row = byUsername.get(quotation.created_by);
    if (!row) continue;
    row.quotations += 1;
    if (quotation.status === 'approved' && quotation.project_id && wonProjectIds.has(quotation.project_id)) {
      row.billing += Number(quotation.total) || 0;
    }
  }

  // Biggest contributor first — the roster itself arrives name-sorted, which
  // tells a manager nothing at a glance. Name breaks ties so the order is
  // stable for a team with no billing yet.
  return rows.sort((a, b) => (b.billing - a.billing) || a.name.localeCompare(b.name));
}
