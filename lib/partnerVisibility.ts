// What a partner may read off a project.
//
// ALLOW-LIST, never a deny-list. Every partner-facing payload in this app is
// built by naming the fields that go out, rather than by taking an internal
// record and deleting the sensitive ones. The difference matters on the day
// someone adds a column: an allow-list silently keeps it internal, a
// deny-list silently publishes it. ProjectRecord has ~60 fields including
// margin inputs, tender EMD/PBG figures, internal closing probabilities and
// override reasons — exactly the set that must never reach a channel
// partner, and exactly the set that keeps growing.
//
// Pure by design (no Sequelize import) so it is directly unit-testable; the
// isolation suite asserts against it field by field.

import type { ProjectNote, ProjectRecord, ProjectTimelineEvent } from './types';
import {
  PartnerProjectStage,
  PARTNER_STAGE_LABEL,
  partnerActionRequired,
  partnerStageProgressPercent,
  resolvePartnerStage
} from './partnerProjectStages';

export interface PartnerVisibleTimelineEvent {
  at: string;
  label: string;
  remarks: string;
}

export interface PartnerVisibleProject {
  id: string;
  reference: string;
  project_name: string;
  client_name: string;
  company: string;
  city: string;
  state: string;
  departments: string[];
  // Echoed back so the portal's detail screen can mirror the internal
  // Overview form. All of it is data the partner typed in themselves.
  phone: string;
  email: string;
  address: string;
  contact_person: string;
  alt_contact_phone: string;
  opportunity_type: string;
  priority: string;
  expected_closing_date: string;
  // NOTE: project.remarks is deliberately NOT here. It is a shared, mutable
  // field — a salesperson edits it with internal commentary once the project
  // is accepted, so exposing it would publish whatever they last wrote. The
  // partner's OWN description is preserved instead as a partner-visible
  // project note at submission time (lib/partnerProjectStore.ts), which
  // nothing internal overwrites.
  // 'active' | 'on_hold' | 'won' | 'lost' — the project's own status, shown
  // beside the stage exactly as the internal header shows it.
  status: string;
  // The partner's own numbers, echoed back. Never approx_price / quote_value
  // — those are this company's commercial position, not the partner's.
  submitted_value: number | '';
  expected_timeline: string;
  stage: PartnerProjectStage;
  stage_label: string;
  progress_percent: number;
  action_required: boolean;
  submission_status: string;
  review_remarks: string;
  reviewed_at: string;
  // Who the partner can actually talk to. A name, never a user id, username,
  // or internal contact routing.
  salesperson_name: string;
  submitted_at: string;
  last_activity_at: string;
  timeline: PartnerVisibleTimelineEvent[];
  notes: PartnerVisibleTimelineEvent[];
}

export interface PartnerProjectContext {
  hasSharedQuotation: boolean;
  hasDemo: boolean;
  /** Resolved display name of the assigned salesperson, or '' before assignment. */
  salespersonName: string;
}

function visibleEvents(events: (ProjectTimelineEvent & { partner_visible?: boolean })[]): PartnerVisibleTimelineEvent[] {
  return events
    // The flag must be explicitly true. An event loaded without the column
    // (an older code path, a partial select) is treated as internal.
    .filter((e) => e.partner_visible === true)
    .map((e) => ({ at: e.at, label: e.label, remarks: e.remarks }));
}

function visibleNotes(notes: (ProjectNote & { partner_visible?: boolean })[]): PartnerVisibleTimelineEvent[] {
  return notes
    .filter((n) => n.partner_visible === true)
    // `by` is dropped deliberately: which internal person wrote a remark is
    // staffing information the partner has no need for, and it would expose
    // the internal username.
    .map((n) => ({ at: n.at, label: 'Update', remarks: n.text }));
}

/**
 * Build the partner-facing view of one project.
 *
 * `reference` is the partner's quotable ID. The internal UUID is still sent
 * as `id` because the portal's own routes need it, but it is never presented
 * as the reference a human reads out.
 */
export function toPartnerVisibleProject(project: ProjectRecord, context: PartnerProjectContext): PartnerVisibleProject {
  const record = project as unknown as Record<string, unknown>;
  const stage = resolvePartnerStage({
    partner_submission_status: (record.partner_submission_status as string) || '',
    stage: project.stage,
    status: project.status,
    sales_person: context.salespersonName,
    hasSharedQuotation: context.hasSharedQuotation,
    hasDemo: context.hasDemo
  });

  const timeline = visibleEvents((project.timeline || []) as (ProjectTimelineEvent & { partner_visible?: boolean })[]);
  const notes = visibleNotes((project.notes || []) as (ProjectNote & { partner_visible?: boolean })[]);
  const lastActivity = [...timeline, ...notes].map((e) => e.at).sort().pop() || project.created_at;

  return {
    id: project.id,
    reference: `PRJ-${project.id.slice(0, 8).toUpperCase()}`,
    project_name: project.project_name || '',
    client_name: project.client_name || '',
    company: project.company || '',
    city: project.city || '',
    state: project.state || '',
    departments: project.departments || [],
    phone: project.phone || '',
    email: project.email || '',
    address: project.address || '',
    contact_person: project.contact_person || '',
    alt_contact_phone: (record.alt_contact_phone as string) || '',
    opportunity_type: project.opportunity_type || '',
    priority: project.priority || '',
    expected_closing_date: project.expected_closing_date || '',
    status: project.status || '',
    submitted_value: (record.partner_submitted_value as number | '') ?? '',
    expected_timeline: (record.partner_expected_timeline as string) || '',
    stage,
    stage_label: PARTNER_STAGE_LABEL[stage],
    progress_percent: partnerStageProgressPercent(stage),
    action_required: partnerActionRequired(stage),
    submission_status: (record.partner_submission_status as string) || '',
    review_remarks: (record.partner_review_remarks as string) || '',
    reviewed_at: (record.partner_reviewed_at as string) || '',
    salesperson_name: context.salespersonName,
    submitted_at: project.created_at,
    last_activity_at: lastActivity,
    timeline,
    notes
  };
}

/**
 * Fields a partner submission form may set, and the only ones the intake
 * path reads off the request body.
 *
 * Named here rather than inline in the route so the test suite can assert
 * that nothing commercially sensitive or assignment-related (approx_price,
 * sales_person, stage, status, project_lead_id, assigned_technical_person_id)
 * can be driven from outside.
 */
export const PARTNER_SUBMITTABLE_FIELDS = [
  'project_name',
  'client_name',
  'company',
  'contact_person',
  'alt_contact_phone',
  'phone',
  'email',
  'address',
  'city',
  'state',
  'opportunity_type',
  'departments',
  'priority',
  'expected_closing_date',
  'remarks',
  'partner_submitted_value',
  'partner_expected_timeline',
  'attachments'
] as const;

/**
 * Fields the internal New Project form has that a partner submission
 * deliberately does NOT, and why. Named rather than merely absent so the
 * omissions read as decisions.
 *
 *  sales_person / salesPersonId     the sales manager assigns on acceptance
 *  technicalPersonIds               likewise — and a partner must never be
 *                                   able to put an internal engineer's name
 *                                   on work nobody has agreed to
 *  project_lead_id                  a third internal-person picker, same rule
 *  source                           forced to 'Partner' by the intake path
 *  approx_price                     our vetted figure; the partner's estimate
 *                                   lands in partner_submitted_value instead
 *  department_amounts               a split of approx_price, which is NULL
 *                                   until acceptance
 *  closing_probability_percent      derived from stage; the server discards
 *                                   the internal form's value too
 *  stage / status                   set by the pipeline, never by a requester
 */
export const PARTNER_WITHHELD_PROJECT_FIELDS = [
  'sales_person',
  'assigned_technical_person_id',
  'project_lead_id',
  'source',
  'approx_price',
  'department_amounts',
  'closing_probability_percent',
  'stage',
  'status'
] as const;
