import { TmsTaskStatus, TmsPriority } from './types';

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
