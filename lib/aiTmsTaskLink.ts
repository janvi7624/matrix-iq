import { db, isUuid } from './db';
import { TmsTaskStatus, TmsPriority, UserRole } from './types';
import { mapTmsStatusToAiStatus, mapTmsPriorityToAiPriority, reverseAiPriority, buildEntryPatchFromTmsTask } from './aiTmsStatusMapping';
import { tmsTaskStore } from './tmsTaskStore';
import { tmsProjectStore } from './tmsProjectStore';
import { logAudit } from './auditLogStore';

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

/**
 * Turns every row carrying a PENDING project choice (tms_project_id, no
 * tms_task_id yet — components/DailyReportForm.tsx's project dropdown) into
 * a real TMS task, created exactly once through the same tmsTaskStore.create
 * the explicit "Create a TMS task from this" button already uses — never a
 * second, parallel insert path. Only called on SUBMIT (see saveReport),
 * deliberately: a draft is documented elsewhere in this app as private and
 * not yet real, and creating a company-visible TMS task from one would
 * break that promise. tms_project_id is a transient CHOICE, not a link —
 * once the task exists this function replaces it with tms_task_id, so a
 * row only ever carries the pending field for the single save where it
 * actually gets resolved.
 *
 * A project selection that no longer holds (removed from the team,
 * deleted, or forged) is quietly dropped rather than creating a task under
 * a project this employee isn't actually on — same "authorization lives
 * here too, not just in the picker" rule applyLiveTasksToEntries follows.
 */
export async function createPendingTmsTasksFromEntries(
  entries: Record<string, unknown>[],
  employeeId: string,
  actorId: string
): Promise<Record<string, unknown>[]> {
  const hasPending = entries.some((e) => !String(e.tms_task_id ?? '').trim() && String(e.tms_project_id ?? '').trim());
  if (!hasPending) return entries;

  const actorRow = await db.User.findByPk(actorId, {
    include: [{ model: db.Role, as: 'role', attributes: ['key'] }],
    attributes: ['id', 'username']
  });
  const actorUsername = (actorRow?.get('username') as string) || '';
  const actorRole = (((actorRow?.get('role') as { key?: string } | null)?.key as UserRole) || 'engineer') as UserRole;

  return Promise.all(
    entries.map(async (entry) => {
      const alreadyLinked = String(entry.tms_task_id ?? '').trim();
      const pendingProjectId = String(entry.tms_project_id ?? '').trim();
      if (alreadyLinked || !pendingProjectId) return entry;

      const project = await tmsProjectStore.findById(pendingProjectId);
      const isMember = !!project && (project.project_manager_id === employeeId || project.team_member_ids.includes(employeeId));
      if (!project || !isMember) {
        const { tms_project_id: _drop, ...rest } = entry;
        return rest;
      }

      const now = new Date().toISOString();
      const created = await tmsTaskStore.create({
        id: `${Date.now()}`,
        created_at: now,
        created_by: actorUsername,
        project_id: pendingProjectId,
        project_name: project.name,
        name: String(entry.task_description ?? '').slice(0, 200) || 'AI Daily Report task',
        assignee_id: employeeId,
        assignee_name: '',
        department_id: project.department_id,
        department_name: '',
        description: String(entry.task_description ?? ''),
        priority: reverseAiPriority(String(entry.priority ?? '')) as TmsPriority,
        status: 'to_do',
        progress_percent: 0,
        start_date: '',
        due_date: String(entry.due_date ?? ''),
        completion_date: '',
        remarks: 'Created from an AI Daily Report entry.',
        attachments: [],
        updated_at: now
      });

      await logAudit({
        by: actorUsername,
        role: actorRole,
        entityType: 'tms_task',
        entityId: created.id,
        action: `Task created from ${actorId === employeeId ? 'their own' : "the employee's"} AI Daily Report entry`,
        previousStatus: '',
        newStatus: created.status,
        remarks: created.name
      });

      const { tms_project_id: _drop, ...rest } = entry;
      return {
        ...rest,
        tms_task_id: created.id,
        ...buildEntryPatchFromTmsTask({
          name: created.name,
          description: created.description,
          dueDate: created.due_date,
          priority: created.priority,
          status: created.status,
          projectName: created.project_name,
          progressPercent: created.progress_percent
        })
      };
    })
  );
}
