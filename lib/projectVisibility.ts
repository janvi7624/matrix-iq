import { ProjectRecord } from './types';

// A Won/Lost project sitting in the main Projects list forever, right
// alongside everything still open, is what got called out as "too much"
// clutter — this is the shared rule for when a closed deal drops out of the
// default view.
//
// WHY STATUS AND NOT AGE
// This used to hide a closed deal only after 90 days (CLOSED_PROJECT_HIDE_
// AFTER_DAYS). The rule worked; it just never matched anything. Measured
// against the live data: of 29 closed projects, 22 closed within 30 days and
// 7 within 90 — none older. So a 90-day threshold removed 0 of 186 rows while
// the complaint was that closed deals were burying the list.
//
//   hide after  0 days -> 29 rows (16% of the list)
//   hide after 30 days ->  7 rows (4%)
//   hide after 90 days ->  0 rows
//
// An invisible delay is also a worse control than a visible rule: a row that
// disappears on a date nobody can see reads as data loss. "It is finished, so
// it is out of my working list" is what people actually mean, and it needs no
// timestamp — which is why closed_at is no longer consulted here. The column
// stays (it is a real record of when a deal closed, and the Billing view and
// reporting both want it), it is simply not what decides visibility.
//
// Nothing is ever deleted or made unreachable. Picking Won or Lost in the
// Status filter shows every one of them, and so does any date range — see
// components/ProjectsView.tsx.

export function isClosedProject(project: Pick<ProjectRecord, 'status'>): boolean {
  return project.status === 'won' || project.status === 'lost';
}

/**
 * Whether closed projects belong in the list given the filters in play.
 *
 * Three independent ways in, any one of which is enough:
 *
 *  1. the Status filter names a closed status — asking for Won is not a
 *     request to be shown nothing;
 *  2. any date range is active. Someone searching a range is asking what
 *     happened then, and an answer that silently omits everything that closed
 *     is worse than no answer. This is the case the old rule missed entirely;
 *  3. the person asked to see them.
 */
export function closedProjectsVisible(input: {
  statusFilter?: string;
  dateFilterActive?: boolean;
  userOverride?: boolean;
}): boolean {
  if (input.userOverride) return true;
  if (input.dateFilterActive) return true;
  const status = (input.statusFilter ?? '').trim();
  return status === 'won' || status === 'lost';
}
