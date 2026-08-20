// Pure label/tone helpers shared across every TMS view component — mirrors
// lib/marketingRequestHelpers.ts's precedent. No fs/db imports here so this
// can run in 'use client' components too.

import { StatusTone } from '@/components/ui/StatusBadge';
import { PriorityTone } from '@/components/ui/PriorityBadge';
import { TmsBomRequestStatus, TmsDeliveryStatus, TmsPriority, TmsProjectStatus, TmsPurchaseStatus, TmsTaskStatus } from './types';

export const TMS_PRIORITY_LABEL: Record<TmsPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const TMS_PRIORITY_TONE: Record<TmsPriority, PriorityTone> = { low: 'cool', medium: 'info', high: 'warm' };

export const TMS_PROJECT_STATUS_LABEL: Record<TmsProjectStatus, string> = {
  planning: 'Planning',
  not_started: 'Not Started',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled'
};
export const TMS_PROJECT_STATUS_TONE: Record<TmsProjectStatus, StatusTone> = {
  planning: 'pending',
  not_started: 'pending',
  in_progress: 'confirmed',
  on_hold: 'pending',
  completed: 'done',
  cancelled: 'cancelled'
};

export const TMS_TASK_STATUS_LABEL: Record<TmsTaskStatus, string> = {
  to_do: 'To Do',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled'
};
export const TMS_TASK_STATUS_TONE: Record<TmsTaskStatus, StatusTone> = {
  to_do: 'pending',
  in_progress: 'confirmed',
  on_hold: 'pending',
  completed: 'done',
  cancelled: 'cancelled'
};

export const TMS_BOM_STATUS_LABEL: Record<TmsBomRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_for_procurement: 'Sent for Procurement',
  completed: 'Completed'
};
export const TMS_BOM_STATUS_TONE: Record<TmsBomRequestStatus, StatusTone> = {
  draft: 'pending',
  submitted: 'pending',
  under_review: 'pending',
  approved: 'confirmed',
  rejected: 'rejected',
  sent_for_procurement: 'confirmed',
  completed: 'done'
};

export const TMS_PURCHASE_STATUS_LABEL: Record<TmsPurchaseStatus, string> = {
  requested: 'Requested',
  quotation_required: 'Quotation Required',
  quotation_received: 'Quotation Received',
  approval_pending: 'Approval Pending',
  approved: 'Approved',
  po_created: 'PO Created',
  ordered: 'Ordered',
  cancelled: 'Cancelled'
};
export const TMS_PURCHASE_STATUS_TONE: Record<TmsPurchaseStatus, StatusTone> = {
  requested: 'pending',
  quotation_required: 'pending',
  quotation_received: 'pending',
  approval_pending: 'pending',
  approved: 'confirmed',
  po_created: 'confirmed',
  ordered: 'done',
  cancelled: 'cancelled'
};

export const TMS_DELIVERY_STATUS_LABEL: Record<TmsDeliveryStatus, string> = {
  pending: 'Pending',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled'
};
export const TMS_DELIVERY_STATUS_TONE: Record<TmsDeliveryStatus, StatusTone> = {
  pending: 'pending',
  partially_received: 'confirmed',
  received: 'done',
  cancelled: 'cancelled'
};

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const TMS_ROLE_LABEL: Record<string, string> = {
  'technical-manager': 'Technical Manager',
  'team-lead': 'Team Lead',
  engineer: 'Engineer',
  technician: 'Technician'
};
