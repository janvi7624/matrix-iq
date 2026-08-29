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
  approved: 'Approved by Technical Manager',
  admin_approved: 'Approved by Administration',
  finance_approved: 'Approved by Finance',
  payment_done: 'Payment Done',
  received: 'Material Received',
  rejected: 'Rejected',
  sent_for_procurement: 'Sent for Procurement',
  completed: 'Completed'
};
export const TMS_BOM_STATUS_TONE: Record<TmsBomRequestStatus, StatusTone> = {
  draft: 'pending',
  submitted: 'pending',
  under_review: 'pending',
  approved: 'confirmed',
  admin_approved: 'confirmed',
  finance_approved: 'confirmed',
  payment_done: 'confirmed',
  received: 'done',
  rejected: 'rejected',
  sent_for_procurement: 'confirmed',
  completed: 'done'
};

// "Which approval is still pending" — one line summarizing the next step in
// the Engineer -> Technical Manager -> Administration -> Finance -> Accounts
// -> Requester chain, so anyone looking at a request can tell at a glance
// where it's stuck without having to know the full status enum.
export function tmsBomPendingApprovalLabel(status: TmsBomRequestStatus): string {
  switch (status) {
    case 'draft':
      return 'Not yet submitted';
    case 'submitted':
    case 'under_review':
      return 'Pending: Technical Manager approval';
    case 'approved':
      return 'Pending: Administration approval';
    case 'admin_approved':
      return 'Pending: Finance approval';
    case 'finance_approved':
      return 'Pending: Accounts payment';
    case 'payment_done':
      return 'Pending: material received confirmation';
    case 'received':
    case 'completed':
      return 'Complete — no approval pending';
    case 'rejected':
      return 'Rejected';
    case 'sent_for_procurement':
      return 'With Procurement';
    default:
      return '';
  }
}

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

// WHAT/WHERE/WHO/WHEN/PRIORITY in one notification — a vague "a task was
// assigned to you" that doesn't say what the task even is was a specific
// reported complaint ("received notifications that a task was expected of
// me, but did not really know what the task was"). Shared by the task
// create and reassignment routes (app/api/tms/tasks/route.ts and
// [id]/route.ts) so the two notification moments never drift apart.
export function formatTmsDueDate(due: string): string {
  if (!due) return 'No due date set';
  try {
    return new Date(due + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return due;
  }
}

export function taskAssignedNotification(taskName: string, projectName: string, assignerName: string, priority: TmsPriority, dueDate: string): { title: string; body: string } {
  return {
    title: 'New Task Assigned',
    body: `"${taskName}"\nProject: ${projectName}\nAssigned by: ${assignerName}\nPriority: ${TMS_PRIORITY_LABEL[priority]}\nDue: ${formatTmsDueDate(dueDate)}`
  };
}

export const TMS_ROLE_LABEL: Record<string, string> = {
  'technical-manager': 'Technical Manager',
  'team-lead': 'Team Lead',
  engineer: 'Engineer',
  technician: 'Technician'
};
