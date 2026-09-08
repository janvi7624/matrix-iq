// Pure label/tone helpers for the General Task engine — shared between
// server routes and 'use client' views, mirroring lib/tmsLabels.ts's
// precedent (no fs/db imports here).

import { StatusTone } from '@/components/ui/StatusBadge';
import { PriorityTone } from '@/components/ui/PriorityBadge';
import { GeneralTaskPriority, GeneralTaskSourceModule, GeneralTaskStatus } from './types';

export const GENERAL_TASK_SOURCE_LABEL: Record<GeneralTaskSourceModule, string> = { admin: 'Admin', hr: 'HR', team: 'Team' };

export const GENERAL_TASK_PRIORITY_LABEL: Record<GeneralTaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const GENERAL_TASK_PRIORITY_TONE: Record<GeneralTaskPriority, PriorityTone> = { low: 'cool', medium: 'info', high: 'warm', critical: 'warm' };

export const GENERAL_TASK_STATUS_LABEL: Record<GeneralTaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  under_review: 'Submitted for Review',
  rework_required: 'Rework Required',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed'
};

// Reuses existing StatusBadge tones (no new CSS) — same mapping approach
// used for TMS's blocked (at_risk)/ready_for_review (on_track) additions.
export const GENERAL_TASK_STATUS_TONE: Record<GeneralTaskStatus, StatusTone> = {
  pending: 'pending',
  in_progress: 'confirmed',
  under_review: 'on_track',
  rework_required: 'at_risk',
  approved: 'done',
  rejected: 'rejected',
  cancelled: 'cancelled',
  completed: 'done'
};

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
