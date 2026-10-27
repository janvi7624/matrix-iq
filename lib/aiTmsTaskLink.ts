import { db, isUuid } from './db';
import { TmsTaskStatus, TmsPriority } from './types';
import { mapTmsStatusToAiStatus, mapTmsPriorityToAiPriority, buildEntryPatchFromTmsTask } from './aiTmsStatusMapping';

export { mapTmsStatusToAiStatus, mapTmsPriorityToAiPriority };

// The AI department's Daily Report <-> TMS Task link.
//
// Unlike GEM Sales' auto-generated Proposal Creation rows
// (lib/gemProposalAutoFetch.ts), an AI task row is never auto-discovered —
// the employee deliberately picks a TMS task to report against each day
// they want to (components/TmsTaskPicker.tsx), since a TMS task spans many
// days and "report on this again today" is a real choice, not a daily pull
// of everything touched. This file's one job is REFRESH: once a row carries
// a tms_task_id, keep its TMS-sourced fields (description, due date,
// priority, status, project, progress) current with the live TmsTask every
// time that day's report is saved — the same "never trust the client,
// recompute on every save" rule GEM's rows already follow, just triggered
// by an explicit link instead of a daily scan.
//
// Nothing here ever WRITES to tms_tasks or tms_task_updates. Status and
// progress changes go through TMS's own UI, which already enforces the
// engineer transition state machine (lib/tmsTaskStore.ts) — duplicating
// that gate here, just to let the Daily Report also push updates, is
// exactly the "parallel version of these rules" the integration brief
// warns against. The Daily Report's role is read-through context plus the
// day's own notes, not a second place to change TMS state.

// The actual TMS <-> AI status/priority maps live in
// lib/aiTmsStatusMapping.ts (re-exported above) — split out so a 'use
// client' component can import the same mapping without pulling in this
// file's Sequelize/pg dependency. See that file for the full reasoning
// behind each value's mapping.

export interface LiveTmsTask {
  id: string;
  assignee_id: string;
  name: string;
  description: string;
  priority: TmsPriority;
  status: TmsTaskStatus;
  due_date: string;
  completion_date: string;
  project_name: string;
  progress_percent: number;
}

async function fetchLiveTasksByIds(ids: string[]): Promise<Map<string, LiveTmsTask>> {
  const validIds = ids.filter(isUuid);
  const byId = new Map<string, LiveTmsTask>();
  if (!validIds.length) return byId;
  const rows = await db.TmsTask.findAll({
    where: { id: validIds } as never,
    include: [{ model: db.TmsProject, as: 'project', attributes: ['id', 'name'] }]
  });
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const project = plain.project as { name?: string } | null;
    byId.set(plain.id as string, {
      id: plain.id as string,
      assignee_id: (plain.assignee_id as string) || '',
      name: (plain.name as string) || '',
      description: (plain.description as string) || '',
      priority: (plain.priority as TmsPriority) || 'medium',
      status: plain.status as TmsTaskStatus,
      due_date: (plain.due_date as string) || '',
      completion_date: (plain.completion_date as string) || '',
      project_name: project?.name || '',
      progress_percent: Number(plain.progress_percent) || 0
    });
  }
  return byId;
}

/**
 * Re-derives every tms_*-sourced field on each linked entry from a map of
 * live TmsTask data, for one employee's report. Entries with no
 * tms_task_id pass through untouched. Pure — no DB access — so the merge
 * rule itself (what overwrites, what's left alone, when a row gets
 * unlinked) is directly testable; refreshTmsLinkedEntries below is the
 * thin DB-fetching wrapper around this that saveReport actually calls.
 *
 * Authorization lives here, not just in the picker: a row's link is only
 * trusted while the task is still actually assigned to THIS employee — if
 * it was reassigned away (or the id is stale/forged, or byId simply has no
 * entry for it), the row is quietly unlinked rather than exposing another
 * employee's task through this one's report. Unlinking freezes the row's
 * last-known values in place rather than blanking them, same as any other
 * field once a report is no longer being actively refreshed.
 */
export function applyLiveTasksToEntries(
  entries: Record<string, unknown>[],
  employeeId: string,
  byId: Map<string, LiveTmsTask>
): Record<string, unknown>[] {
  return entries.map((entry) => {
    const linkId = String(entry.tms_task_id ?? '').trim();
    if (!linkId) return entry;

    const task = byId.get(linkId);
    if (!task || task.assignee_id !== employeeId) {
      const { tms_task_id: _id, tms_status_label: _label, tms_project_name: _project, tms_progress_percent: _progress, ...rest } = entry;
      return rest;
    }

    // completed_on for a linked row comes straight from TMS's own
    // completion_date, not carryCompletions' content-hash guess (which
    // exists only because a STANDALONE row has no external authority) —
    // this must win regardless of what carryCompletions already set, so
    // callers run this AFTER it, not before. Dropped outright (not just
    // blanked) when not Completed, same as withoutStamp does elsewhere.
    const { completed_on: _priorStamp, ...entryWithoutStamp } = entry;
    return {
      ...entryWithoutStamp,
      ...buildEntryPatchFromTmsTask({
        name: task.name,
        description: task.description,
        dueDate: task.due_date,
        priority: task.priority,
        status: task.status,
        projectName: task.project_name,
        progressPercent: task.progress_percent,
        completionDate: task.completion_date
      })
    };
  });
}

/**
 * Runs on every save, draft or submit — same as GEM's auto-rows — so a
 * draft in progress shows live context while the employee is still editing
 * it. Because each reporting day is its own report/entries, this never
 * touches an earlier day's already-submitted row: only the report actually
 * being saved right now is re-derived, which is exactly what keeps a past
 * day's numbers historically accurate while today's stays current.
 */
export async function refreshTmsLinkedEntries(entries: Record<string, unknown>[], employeeId: string): Promise<Record<string, unknown>[]> {
  const linkedIds = [...new Set(entries.map((e) => String(e.tms_task_id ?? '').trim()).filter(Boolean))];
  if (!linkedIds.length) return entries;

  const byId = await fetchLiveTasksByIds(linkedIds);
  return applyLiveTasksToEntries(entries, employeeId, byId);
}
