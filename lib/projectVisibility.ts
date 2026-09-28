import { ProjectRecord } from './types';

// A Won/Lost project sitting in the main Projects list forever, right
// alongside everything still open, is what got called out as "too much"
// clutter — this is the shared rule for when a closed deal ages out of the
// default (no Status filter) view. Nothing is ever deleted or made
// unreachable: picking Won or Lost explicitly in the Status filter still
// shows every one of them, aged or not (see components/ProjectsView.tsx).
export const CLOSED_PROJECT_HIDE_AFTER_DAYS = 90;

export function isAgedClosedProject(project: Pick<ProjectRecord, 'status' | 'closed_at'>, now: Date = new Date()): boolean {
  if (project.status !== 'won' && project.status !== 'lost') return false;
  if (!project.closed_at) return false;
  const closedAt = new Date(project.closed_at);
  if (Number.isNaN(closedAt.getTime())) return false;
  const daysSinceClosed = (now.getTime() - closedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceClosed > CLOSED_PROJECT_HIDE_AFTER_DAYS;
}
