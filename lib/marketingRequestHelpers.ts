// Pure helpers shared between server (API routes) and client (list view) —
// no fs/blob imports here so this can run in 'use client' components too.

import { MarketingRequestPriority, MarketingRequestRecord, MarketingRequestStatus, MarketingRequestType } from './types';

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

export const MARKETING_PRIORITY_META: Record<MarketingRequestPriority, { icon: string; label: string; hint: string }> = {
  urgent: { icon: '🔴', label: 'Urgent', hint: 'Needed within a day or two' },
  high: { icon: '🟠', label: 'High', hint: 'Needed this week' },
  medium: { icon: '🟡', label: 'Medium', hint: 'Needed in the next couple of weeks' },
  low: { icon: '🟢', label: 'Low', hint: 'No rush — whenever it fits the queue' }
};

export const MARKETING_STATUS_LABEL: Record<MarketingRequestStatus, string> = {
  submitted: 'New / Awaiting Review',
  timeline_set: 'Timeline Set',
  in_progress: 'In Progress',
  waiting_info: 'Waiting for Information',
  ready_for_review: 'Ready for Review',
  completed: 'Completed',
  rejected: 'Declined',
  cancelled: 'Cancelled'
};

// A ticket is "overdue" once it's past the committed delivery date and still
// not marked completed — backs the "Overdue" badge in the list view. Kept
// here (not inline in the component) so a future stats/report route can
// reuse the exact same definition.
export function isMarketingRequestOverdue(record: Pick<MarketingRequestRecord, 'timeline' | 'status'>): boolean {
  if (!record.timeline || record.status === 'completed' || record.status === 'rejected' || record.status === 'cancelled') return false;
  const dueTime = new Date(record.timeline.expectedDeliveryDate).getTime();
  if (Number.isNaN(dueTime)) return false;
  return Date.now() > dueTime;
}
