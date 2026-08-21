// Pure helpers shared between server (API routes) and client (list view) —
// no fs/blob imports here so this can run in 'use client' components too.

import {
  MarketingProductCategory,
  MarketingRequestPriority,
  MarketingRequestRecord,
  MarketingRequestStatus,
  MarketingRequestType
} from './types';

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

export const MARKETING_STATUS_LABEL: Record<MarketingRequestStatus, string> = {
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
