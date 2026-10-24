// What a partner may read off a marketing request.
//
// ALLOW-LIST, never a deny-list — same rule as lib/partnerVisibility.ts, and
// for the same reason: MarketingRequestRecord carries an entire internal
// workspace (marketing_prepared_content, marketing_remarks,
// technical_instructions, technical_remarks, assignment_decline_reason, plus
// the usernames and real names of the assigned marketing member and the
// technical reviewer). None of that is the partner's business, and the set
// grows every time the workflow gains a step.
//
// What a partner DOES get is everything they typed in themselves, an honest
// position in the seven-step workflow, and the finished deliverables.
//
// Pure by design (no Sequelize import) so the isolation suite can assert
// against it field by field.

import type {
  MarketingProductCategory,
  MarketingRequestPriority,
  MarketingRequestRecord,
  MarketingRequestStatus,
  MarketingRequestType
} from './types';

/** The coarse position a partner sees, derived — never a stored column. */
export type PartnerMarketingStage =
  | 'submitted'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'rejected';

export const PARTNER_MARKETING_STAGE_LABEL: Record<PartnerMarketingStage, string> = {
  submitted: 'Submitted',
  in_progress: 'In progress',
  in_review: 'In review',
  completed: 'Completed',
  rejected: 'Not proceeding'
};

export const PARTNER_MARKETING_STAGE_ORDER: PartnerMarketingStage[] = [
  'submitted',
  'in_progress',
  'in_review',
  'completed'
];

/**
 * Collapse the internal status onto the partner-facing stage.
 *
 * Deliberately coarser than MARKETING_STATUS_LABEL. The internal vocabulary
 * names who is holding the ticket — 'pending_technical_review',
 * 'tech_changes_requested', 'marketing_final_review' — which tells a partner
 * about our internal handoffs and, worse, reads as a problem on their side
 * when it is routine. 'In review' says the true thing without the org chart.
 */
export function resolvePartnerMarketingStage(status: MarketingRequestStatus): PartnerMarketingStage {
  switch (status) {
    case 'submitted':
    case 'approved':
    case 'timeline_set':
      return 'submitted';
    case 'marketing_in_progress':
    case 'in_progress':
    case 'waiting_info':
    case 'tech_changes_requested':
      return 'in_progress';
    case 'pending_technical_review':
    case 'technical_approved':
    case 'marketing_final_review':
    case 'ready_for_review':
      return 'in_review';
    case 'completed':
      return 'completed';
    default:
      // 'rejected' / 'cancelled' and anything added later land here. Defaulting
      // an UNKNOWN status to 'rejected' would be alarming and wrong, so only
      // the two known terminal-negative values map here; see the guard below.
      return status === 'rejected' || status === 'cancelled' ? 'rejected' : 'submitted';
  }
}

export function partnerMarketingProgressPercent(stage: PartnerMarketingStage): number {
  if (stage === 'rejected') return 0;
  const index = PARTNER_MARKETING_STAGE_ORDER.indexOf(stage);
  if (index < 0) return 0;
  return Math.round(((index + 1) / PARTNER_MARKETING_STAGE_ORDER.length) * 100);
}

/** Is the ball in the partner's court? Drives the dashboard's action prompt. */
export function partnerMarketingActionRequired(record: { status: MarketingRequestStatus }): boolean {
  return record.status === 'waiting_info';
}

export interface PartnerVisibleMarketingRequest {
  id: string;
  created_at: string;
  updated_at: string;
  // Echoed back so the portal's detail screen mirrors the internal form.
  // All of it is data the partner typed in themselves.
  title: string;
  product_category: MarketingProductCategory;
  request_type: MarketingRequestType;
  description: string;
  additional_info: string;
  priority: MarketingRequestPriority;
  needed_by_date: string;
  attachments: string[];
  project_id: string;
  // Derived position, never the raw internal status string.
  stage: PartnerMarketingStage;
  stage_label: string;
  progress_percent: number;
  action_required: boolean;
  // The finished work, and only once it is actually finished.
  final_notes: string;
  final_files: string[];
  // Why it is not proceeding, if it is not. Reuses the existing
  // rejection_reason, which is already written to be read by the requester.
  rejection_reason: string;
}

/**
 * The fields a partner may SEND when raising a request.
 *
 * Everything else on MarketingRequestRecord — status, assignment, every
 * workspace field — is set by us, never accepted from the portal. The API
 * route reads this list rather than spreading the request body.
 */
export const PARTNER_MARKETING_SUBMITTABLE_FIELDS = [
  'title',
  'productCategory',
  'requestType',
  'description',
  'additionalInfo',
  'priority',
  'neededByDate',
  'attachments',
  'projectId'
] as const;

export function toPartnerVisibleMarketingRequest(record: MarketingRequestRecord): PartnerVisibleMarketingRequest {
  const stage = resolvePartnerMarketingStage(record.status);
  const completed = stage === 'completed';
  return {
    id: record.id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    title: record.title,
    product_category: record.product_category,
    request_type: record.request_type,
    description: record.description,
    additional_info: record.additional_info,
    priority: record.priority,
    needed_by_date: record.needed_by_date,
    attachments: Array.isArray(record.attachments) ? record.attachments : [],
    project_id: record.project_id,
    stage,
    stage_label: PARTNER_MARKETING_STAGE_LABEL[stage],
    progress_percent: partnerMarketingProgressPercent(stage),
    action_required: partnerMarketingActionRequired(record),
    // Withheld until completion. final_submission_* is a working draft right
    // up to the moment Marketing delivers, and an in-flight draft reaching
    // the partner would be read as the deliverable.
    final_notes: completed ? record.final_submission_notes : '',
    final_files: completed && Array.isArray(record.final_submission_files) ? record.final_submission_files : [],
    rejection_reason: stage === 'rejected' ? record.rejection_reason : ''
  };
}
