// Generalizes the overdue/due-today/upcoming buckets TmsDashboardView.tsx and
// TmsTasksView.tsx already compute inline for tasks, so the same classifier
// can also drive a project-level deadline-health indicator (see
// components/TmsProjectDetailView.tsx). Pure date math, no DB — safe in
// 'use client' components too.

export type DeadlineBucket = 'completed' | 'overdue' | 'due_today' | 'due_tomorrow' | 'due_this_week' | 'on_track' | 'none';

function toMidnight(iso: string): number {
  return new Date(iso + 'T00:00:00').getTime();
}

export function classifyDeadline(dueDateIso: string, isCompleted = false, now: Date = new Date()): DeadlineBucket {
  if (isCompleted) return 'completed';
  if (!dueDateIso) return 'none';

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = toMidnight(dueDateIso);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((due - today) / dayMs);

  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'due_today';
  if (diffDays === 1) return 'due_tomorrow';
  if (diffDays <= 7) return 'due_this_week';
  return 'on_track';
}

export const DEADLINE_BUCKET_LABEL: Record<DeadlineBucket, string> = {
  completed: 'Completed',
  overdue: 'Overdue',
  due_today: 'Due Today',
  due_tomorrow: 'Due Tomorrow',
  due_this_week: 'Due This Week',
  on_track: 'On Track',
  none: 'No Deadline Set'
};

// Maps onto the same red/yellow/green health-band tokens as
// components/ui/HealthGauge.tsx's BAND_COLOR (var(--mx-danger)/warning/success),
// rather than introducing new colors for what is conceptually the same
// "how healthy is this" signal.
export const DEADLINE_BUCKET_BAND: Record<DeadlineBucket, 'red' | 'yellow' | 'green' | 'na'> = {
  completed: 'green',
  overdue: 'red',
  due_today: 'yellow',
  due_tomorrow: 'yellow',
  due_this_week: 'yellow',
  on_track: 'green',
  none: 'na'
};
