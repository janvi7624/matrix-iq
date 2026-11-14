// Pure helpers shared between server (API routes) and client (list view) —
// no fs/blob imports here so this can run in 'use client' components too.

import {
  MARKETING_PRODUCT_CATEGORIES,
  MarketingProductCategory,
  MarketingRequestPriority,
  MarketingRequestRecord,
  MarketingRequestStatus,
  MarketingRequestType
} from './types';

// The 5 real technical product categories — everything else (the explicit
// 'Other' bucket, or an ad-hoc category like FestivalCampaign's "Festival
// Greeting", which isn't in MARKETING_PRODUCT_CATEGORIES at all) is
// non-technical. Allow-list, not deny-list: a new non-technical category
// added anywhere in the app is safe by default instead of silently needing
// a technical reviewer it was never meant to have.
const TECHNICAL_MARKETING_CATEGORIES = new Set<string>(
  MARKETING_PRODUCT_CATEGORIES.filter((c) => c !== 'Other')
);

export const MARKETING_REQUEST_TYPE_LABEL: Record<MarketingRequestType, string> = {
  brochure_flyer: 'Brochure / Flyer',
  social_media: 'Social Media Post',
  banner_standee: 'Banner / Standee Design',
  video_reel: 'Video / Reel',
  email_campaign: 'Email Campaign',
  website_update: 'Website Update',
  product_photography: 'Product Photography',
  event_collateral: 'Event Collateral',
  other: 'Other'
};

export const MARKETING_PRIORITY_META: Record<MarketingRequestPriority, { label: string; hint: string }> = {
  urgent: { label: 'Urgent', hint: 'Needed within a day or two' },
  high: { label: 'High', hint: 'Needed this week' },
  medium: { label: 'Medium', hint: 'Needed in the next couple of weeks' },
  low: { label: 'Low', hint: 'No rush — whenever it fits the queue' }
};

/**
 * The six stages anyone outside Marketing is ever shown.
 *
 * There are fourteen stored statuses. Eleven of them had never been used once
 * in the first four months, and the four that were in play
 * ('submitted', 'tech_changes_requested', 'completed') were being read against
 * a vocabulary of fourteen — so the status badge named our internal handoffs
 * ('Pending Technical Review', 'Marketing Final Review', 'Timeline Set')
 * rather than answering the only question a requester has: where is my thing
 * and is anyone waiting on me?
 *
 * The stored status is NOT changed. It stays as the precise record of which
 * handoff a request sits in — Marketing's own workspace still needs that, and
 * rewriting fourteen values across live rows would be a migration with
 * nothing to gain. This is the vocabulary everything else reads.
 *
 * Six and not five: lib/partnerMarketingVisibility.ts already collapses the
 * same statuses onto five partner-facing stages, and this deliberately mirrors
 * its buckets so the product speaks with one voice. The extra one is
 * 'needs_you', because "we are waiting on YOU" is the single most actionable
 * thing a status can say and folding it into 'in_progress' — which is what
 * the partner view does, correctly, since a partner cannot act on it — would
 * throw that away for the people who can.
 */
export type MarketingStage = 'submitted' | 'in_progress' | 'needs_you' | 'in_review' | 'completed' | 'closed';

export const MARKETING_STAGE_ORDER: MarketingStage[] = [
  'submitted',
  'in_progress',
  'needs_you',
  'in_review',
  'completed'
];

export const MARKETING_STAGE_LABEL: Record<MarketingStage, string> = {
  submitted: 'Submitted',
  in_progress: 'In Progress',
  needs_you: 'Needs Your Input',
  in_review: 'In Review',
  completed: 'Completed',
  closed: 'Closed'
};

/** Which stage a stored status belongs to. */
export function marketingStageOf(status: MarketingRequestStatus | string): MarketingStage {
  switch (status) {
    case 'submitted':
    case 'approved':
    case 'timeline_set':
      return 'submitted';
    case 'marketing_in_progress':
    case 'in_progress':
    // Technical asked Marketing for changes — the ball is with Marketing,
    // not with whoever raised the request, so this is NOT 'needs_you'.
    case 'tech_changes_requested':
      return 'in_progress';
    case 'waiting_info':
      return 'needs_you';
    case 'pending_technical_review':
    case 'technical_approved':
    case 'marketing_final_review':
    case 'ready_for_review':
      return 'in_review';
    case 'completed':
      return 'completed';
    case 'rejected':
    case 'cancelled':
      return 'closed';
    default:
      // An unknown or newly added status must never read as finished or
      // declined — both would be alarming and wrong. It reads as "with us".
      return 'in_progress';
  }
}

/**
 * What the badge says for a stored status — the stage's label, except for
 * the two terminal-negative values, which stay distinguishable because
 * "we declined this" and "you withdrew it" are not the same event.
 */
export const MARKETING_STATUS_LABEL: Record<MarketingRequestStatus, string> = {
  submitted: 'Submitted',
  approved: 'Submitted',
  timeline_set: 'Submitted',
  marketing_in_progress: 'In Progress',
  in_progress: 'In Progress',
  tech_changes_requested: 'In Progress',
  waiting_info: 'Needs Your Input',
  pending_technical_review: 'In Review',
  technical_approved: 'In Review',
  marketing_final_review: 'In Review',
  ready_for_review: 'In Review',
  completed: 'Completed',
  rejected: 'Declined',
  cancelled: 'Cancelled'
};

/**
 * The precise internal status, for Marketing's own workspace only.
 *
 * Keeps the old vocabulary available where it is genuinely useful — the
 * person doing the work needs to know whether a request is waiting on
 * Technical or on their own final check. Everyone else gets the six stages.
 */
export const MARKETING_INTERNAL_STATUS_LABEL: Record<MarketingRequestStatus, string> = {
  submitted: 'Submitted / Awaiting Marketing',
  approved: 'Approved',
  marketing_in_progress: 'Marketing In Progress',
  pending_technical_review: 'Pending Technical Review',
  technical_approved: 'Technical Approved',
  tech_changes_requested: 'Changes Requested',
  marketing_final_review: 'Marketing Final Review',
  completed: 'Completed',
  timeline_set: 'Timeline Set',
  in_progress: 'In Progress',
  waiting_info: 'Waiting for Information',
  ready_for_review: 'Ready for Review',
  rejected: 'Declined',
  cancelled: 'Cancelled'
};

export const PRODUCT_CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  AV: { bg: 'rgba(59, 130, 246, 0.12)', text: '#2563eb', border: 'rgba(59, 130, 246, 0.3)' },
  Robotics: { bg: 'rgba(236, 72, 153, 0.12)', text: '#db2777', border: 'rgba(236, 72, 153, 0.3)' },
  'AI Video Analytics (Video Management System)': { bg: 'rgba(16, 185, 129, 0.12)', text: '#059669', border: 'rgba(16, 185, 129, 0.3)' },
  'AI Video Analytics': { bg: 'rgba(16, 185, 129, 0.12)', text: '#059669', border: 'rgba(16, 185, 129, 0.3)' },
  'System Integration': { bg: 'rgba(139, 92, 246, 0.12)', text: '#7c3aed', border: 'rgba(139, 92, 246, 0.3)' },
  'VisitIQ VMS (Visitor Management System)': { bg: 'rgba(245, 158, 11, 0.12)', text: '#d97706', border: 'rgba(245, 158, 11, 0.3)' },
  'VisitIQ VMS': { bg: 'rgba(245, 158, 11, 0.12)', text: '#d97706', border: 'rgba(245, 158, 11, 0.3)' },
  Other: { bg: 'rgba(107, 114, 128, 0.12)', text: '#4b5563', border: 'rgba(107, 114, 128, 0.3)' }
};

// Only a request tagged with an actual technical product category needs
// engineering sign-off — a Festival banner or other generic collateral
// tagged 'Other' has no technical spec to verify, so it skips Technical
// Review entirely (see send-to-technical/route.ts).
export function isTechnicalMarketingCategory(category: MarketingProductCategory): boolean {
  return TECHNICAL_MARKETING_CATEGORIES.has(category);
}

export function getProductCategoryStyle(category: MarketingProductCategory) {
  return PRODUCT_CATEGORY_COLORS[category] || PRODUCT_CATEGORY_COLORS.Other;
}

export function isMarketingRequestOverdue(record: Pick<MarketingRequestRecord, 'timeline' | 'needed_by_date' | 'status'>): boolean {
  if (record.status === 'completed' || record.status === 'rejected' || record.status === 'cancelled') return false;
  const targetDate = record.timeline?.expectedDeliveryDate || record.needed_by_date;
  if (!targetDate) return false;
  const dueTime = new Date(targetDate).getTime();
  if (Number.isNaN(dueTime)) return false;
  return Date.now() > dueTime;
}
