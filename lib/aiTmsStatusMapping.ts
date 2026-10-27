import { TmsTaskStatus, TmsPriority } from './types';
import { TMS_TASK_STATUS_LABEL, EngineerTaskAction } from './tmsLabels';

// The pure TMS <-> AI Daily Report value maps, split out from
// lib/aiTmsTaskLink.ts specifically so they can be imported from a 'use
// client' component (components/TmsTaskPicker.tsx, DailyReportForm.tsx's
// optimistic client-side populate) without pulling in lib/db.ts's
// Sequelize/pg — same reason lib/tmsConstants.ts is split out from
// lib/tmsAccess.ts. See aiTmsTaskLink.ts for the full reasoning behind the
// mapping choices themselves; this file is just where both the client and
// the server read them from, so the two can never drift apart.

const TMS_STATUS_TO_AI_STATUS: Record<TmsTaskStatus, string> = {
  to_do: 'Pending',
  in_progress: 'In Progress',
  blocked: 'In Progress',
  on_hold: 'In Progress',
  ready_for_review: 'In Progress',
  cancelled: 'Pending',
  completed: 'Completed'
};

const TMS_PRIORITY_TO_AI_PRIORITY: Record<TmsPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
};

export function mapTmsStatusToAiStatus(status: string): string {
  return TMS_STATUS_TO_AI_STATUS[status as TmsTaskStatus] ?? 'Pending';
}

export function mapTmsPriorityToAiPriority(priority: string): string {
  return TMS_PRIORITY_TO_AI_PRIORITY[priority as TmsPriority] ?? 'Medium';
}

const AI_PRIORITY_TO_TMS_PRIORITY: Record<string, TmsPriority> = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  // TMS has no 'Critical' slot — the closest real tier is 'high'. Only
  // reachable here because an entry can carry 'Critical' from BEFORE it was
  // linked (preserved on link, since priority stays display-only for a
  // standalone row); once linked it's TMS-sourced and this case does not
  // recur.
  Critical: 'high'
};

/** The AI display priority back to TMS's own value — for pre-filling
 *  TmsLinkedTaskPanel's "Edit Details" priority select from the entry's
 *  already-mapped display field, without a second fetch. */
export function reverseAiPriority(aiPriority: string): string {
  return AI_PRIORITY_TO_TMS_PRIORITY[aiPriority] ?? 'medium';
}

// The fields a linked AI Daily Report row derives from a live TMS task —
// shape-normalized so the three places that build this patch (the picker's
// optimistic fill, lib/aiTmsTaskLink.ts's on-save refresh, and
// TmsLinkedTaskPanel's post-update patch) read it from one function instead
// of three copies that can drift.
export interface TmsTaskDisplayFields {
  name: string;
  description: string;
  dueDate: string;
  priority: string;
  status: string;
  projectName: string;
  progressPercent: number;
  completionDate?: string;
}

export function buildEntryPatchFromTmsTask(fields: TmsTaskDisplayFields): Record<string, unknown> {
  const aiStatus = mapTmsStatusToAiStatus(fields.status);
  return {
    // A TMS task's description is optional (many are filed with just a
    // name) — falling back to the name keeps this REQUIRED AI field from
    // ever going blank on a linked row.
    task_description: fields.description || fields.name,
    // "Project / Category" IS the real TMS project name for a linked row —
    // the field no longer has a separate "Client/Internal/Other" meaning of
    // its own (see AI_TEMPLATE's own comment on `project`). Kept as the one
    // field rather than a parallel tms_project_name, so anywhere that
    // already reads entry.project (DailyReportReadView's generic field
    // rendering, for one) shows the right thing with no separate case.
    project: fields.projectName,
    due_date: fields.dueDate,
    priority: mapTmsPriorityToAiPriority(fields.priority),
    status: aiStatus,
    tms_status_label: TMS_TASK_STATUS_LABEL[fields.status as TmsTaskStatus] ?? fields.status,
    tms_progress_percent: `${fields.progressPercent}%`,
    ...(aiStatus === 'Completed' && fields.completionDate ? { completed_on: fields.completionDate } : {})
  };
}

// Mirrors lib/tmsTaskStore.ts's VALID_TRANSITIONS — for button visibility
// only, same disclaimer as TmsTaskDetailView.tsx's own copy of this table
// (which now imports it from here instead of declaring it twice): the real
// enforcement is server-side in app/api/tms/tasks/[id]/update/route.ts, so a
// stale/wrong entry here would at worst show a button the server then
// rejects with a clear message.
export const ENGINEER_ACTIONS_BY_STATUS: Record<TmsTaskStatus, EngineerTaskAction[]> = {
  to_do: ['start'],
  in_progress: ['progress', 'blocked', 'ready_for_review'],
  blocked: ['reopen'],
  ready_for_review: [],
  on_hold: [],
  completed: [],
  cancelled: []
};

const LABEL_TO_STATUS: Record<string, TmsTaskStatus> = Object.fromEntries(
  Object.entries(TMS_TASK_STATUS_LABEL).map(([status, label]) => [label, status as TmsTaskStatus])
);

/**
 * Which engineer actions make sense right now, from the status LABEL a
 * linked AI entry already carries (tms_status_label) — so a caller that only
 * has the AI Daily Report's own display fields, not a fresh TmsTaskRecord,
 * can still filter sensibly without a second network round trip.
 */
export function engineerActionsForStatusLabel(label: string): EngineerTaskAction[] {
  const status = LABEL_TO_STATUS[label];
  return status ? ENGINEER_ACTIONS_BY_STATUS[status] : [];
}
