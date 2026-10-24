// What a partner sees as "where my project is".
//
// Pure, no imports beyond types — so it is unit-testable and can be used by
// client components without pulling Sequelize into the browser bundle, the
// same arrangement lib/projectStages.ts and lib/leadSources.ts already use.
//
// This is a DERIVATION, not a second state machine. The requirement listed
// eleven partner-facing stages; the projects table already has an eight-step
// forward pipeline plus a status, and demo_schedule has its own eleven-value
// enum. Adding the requirement's list as real columns would have meant two
// sources of truth for one question and a Postgres enum migration — and
// Postgres cannot drop an enum value once added, so a wrong guess would be
// permanent. Mapping instead means the internal pipeline stays the only
// thing anyone updates, and the partner view can be corrected freely.

import type { ProjectStage } from './types';

export type PartnerSubmissionStatus = 'submitted' | 'info_requested' | 'approved' | 'rejected';

export const PARTNER_SUBMISSION_STATUSES: PartnerSubmissionStatus[] = ['submitted', 'info_requested', 'approved', 'rejected'];

export type PartnerProjectStage =
  | 'submitted'
  | 'awaiting_review'
  | 'info_requested'
  | 'rejected'
  | 'prospect'
  | 'demo'
  | 'quotation_shared'
  | 'negotiation'
  | 'commit'
  | 'won'
  | 'lost'
  | 'on_hold';

// Mirrors STAGE_LABEL in lib/projectStages.ts for the post-approval stages,
// on purpose: the partner's progress stepper should read the same as the one
// the sales team looks at, so a conversation about "where is it" does not
// need translating. The two pre-approval states have no internal equivalent
// because internally the project simply exists.
export const PARTNER_STAGE_LABEL: Record<PartnerProjectStage, string> = {
  submitted: 'Submitted',
  awaiting_review: 'Awaiting sales review',
  info_requested: 'Information requested',
  rejected: 'Not taken forward',
  prospect: 'Prospect',
  demo: 'Demo / Qualified',
  quotation_shared: 'Quotation',
  negotiation: 'Negotiation',
  commit: 'Commit',
  won: 'Won',
  lost: 'Lost',
  on_hold: 'On hold'
};

/**
 * The partner-facing progress bar. Terminal and exception states
 * (info_requested, rejected, won/lost/on_hold) are deliberately absent —
 * a stepper is for the happy path; everything else is shown as a status.
 */
export const PARTNER_STAGE_STEPS: PartnerProjectStage[] = [
  'submitted',
  'awaiting_review',
  'prospect',
  'demo',
  'quotation_shared',
  'negotiation',
  'commit'
];

export interface PartnerStageInput {
  partner_submission_status: string;
  stage: ProjectStage | string;
  status: string;
  sales_person: string;
  /** True when at least one non-revoked quotation share exists for this project. */
  hasSharedQuotation: boolean;
  /** True when the project has any demo request attached. */
  hasDemo: boolean;
}

/**
 * Resolve the single stage a partner should be shown.
 *
 * Order matters and encodes precedence:
 *   1. The submission gate. Until Sales accepts, nothing downstream is real
 *      — a project sitting at 'cold_call' because that is the DB default
 *      must not read as "requirement analysis" to the partner.
 *   2. Terminal status (won/lost/on_hold) outranks any stage.
 *   3. Then the pipeline, read from the furthest-along evidence: a shared
 *      quotation outranks a demo, which outranks early-stage work.
 */
export function resolvePartnerStage(input: PartnerStageInput): PartnerProjectStage {
  const submission = input.partner_submission_status;

  if (submission === 'rejected') return 'rejected';
  if (submission === 'info_requested') return 'info_requested';
  if (submission === 'submitted' || !submission) {
    // No submission status at all means this is not a partner submission;
    // callers should not be asking, but 'awaiting_review' is the safe answer
    // — it claims no progress that may not have happened.
    return 'awaiting_review';
  }

  // From here the submission is approved.
  if (input.status === 'won') return 'won';
  if (input.status === 'lost') return 'lost';
  if (input.status === 'on_hold') return 'on_hold';
  if (input.stage === 'closed_lost') return 'lost';

  // Mirrors the live internal pipeline (lib/projectStages.ts FORWARD_STAGES:
  // prospect -> demo -> quotation -> negotiation -> commit). The retired
  // values are still mapped because the enum keeps them and old rows carry
  // them — 'cold_call' in particular is the pre-rename spelling of
  // 'prospect' and is still settable.
  switch (input.stage) {
    case 'commit':
    case 'po_received':
    case 'installation':
    case 'completed':
      return 'commit';
    case 'negotiation':
      return 'negotiation';
    case 'quotation':
    case 'customer_response':
      return 'quotation_shared';
    case 'demo':
      return 'demo';
    case 'prospect':
    case 'cold_call':
    case 'catalogue_offered':
    case 'site_visit':
      // A shared quotation or a booked demo is harder evidence than an
      // un-advanced stage field, so it still wins at the early stages.
      if (input.hasSharedQuotation) return 'quotation_shared';
      if (input.hasDemo) return 'demo';
      return 'prospect';
    default:
      if (input.hasSharedQuotation) return 'quotation_shared';
      if (input.hasDemo) return 'demo';
      return 'prospect';
  }
}

/**
 * How far along the stepper to paint. -1 for stages that are not steps
 * (rejected, won, on hold, ...), which the UI renders as a status instead.
 */
export function partnerStageIndex(stage: PartnerProjectStage): number {
  return PARTNER_STAGE_STEPS.indexOf(stage);
}

export function partnerStageProgressPercent(stage: PartnerProjectStage): number {
  if (stage === 'won') return 100;
  if (stage === 'rejected' || stage === 'lost') return 0;
  const index = partnerStageIndex(stage);
  if (index === -1) return 0;
  return Math.round(((index + 1) / PARTNER_STAGE_STEPS.length) * 100);
}

/** Whether the partner is the one holding things up. Drives the portal's call to action. */
export function partnerActionRequired(stage: PartnerProjectStage): boolean {
  return stage === 'info_requested';
}

/**
 * Review transitions a Sales reviewer may apply, keyed by current status.
 *
 * 'approved' is deliberately terminal: once a submission is accepted it
 * becomes an ordinary project, and un-accepting it would strand whatever
 * work (quotations, demos, assignments) has happened since. A project that
 * turns out to be bad news is closed through the normal pipeline — lost /
 * on hold — not by retracting its acceptance.
 */
const ALLOWED_REVIEW_TRANSITIONS: Record<string, PartnerSubmissionStatus[]> = {
  submitted: ['approved', 'rejected', 'info_requested'],
  info_requested: ['approved', 'rejected'],
  rejected: ['approved'],
  approved: []
};

export function canReviewTransition(from: string, to: PartnerSubmissionStatus): boolean {
  return (ALLOWED_REVIEW_TRANSITIONS[from] || []).includes(to);
}
