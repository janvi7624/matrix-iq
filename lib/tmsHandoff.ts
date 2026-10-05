import { Op } from 'sequelize';
import { db } from './db';
import { tmsProjectStore, nextTmsProjectCode } from './tmsProjectStore';
import { projectStore } from './projectStore';
import { ProjectRecord, TmsProjectRecord, UserRecord } from './types';

// Bridges a Sales assignment into TMS: when a technical person is assigned
// to a Sales Project (assigned_technical_person_id), a matching TMS project
// should exist for them to see under "My Projects" — otherwise the
// assignment is invisible on the TMS side even though the Sales side shows
// it. Best-effort: any failure here must never break the Sales assignment
// that triggered it, so every call site wraps this in try/catch.
export async function syncTmsProjectForAssignment(project: ProjectRecord, assignedPerson: UserRecord, actorUsername: string): Promise<void> {
  // tms_projects.department_id is NOT NULL — nothing valid to create or
  // target if the assignee has no department on file. The Sales assignment
  // still succeeds; TMS setup for this project just stays a manual step.
  if (!assignedPerson.department) return;

  const deptRow = await db.Department.findOne({ where: { name: assignedPerson.department } as never, attributes: ['id'] });
  const departmentId = deptRow ? (deptRow.get('id') as string) : '';
  if (!departmentId) return;

  if (project.tms_project_id) {
    const existing = await tmsProjectStore.findById(project.tms_project_id);
    if (existing) {
      const teamIds = new Set(existing.team_member_ids);
      teamIds.add(assignedPerson.id);
      await tmsProjectStore.update(existing.id, {
        department_id: departmentId,
        team_member_ids: Array.from(teamIds)
      });
      return;
    }
    // Linked id points at a project that no longer exists (deleted) — fall
    // through and create a fresh one below.
  }

  const draft: TmsProjectRecord = {
    id: '',
    project_code: await nextTmsProjectCode(),
    created_at: '',
    created_by: actorUsername,
    name: project.client_name || project.company || 'Untitled project',
    client_name: project.client_name,
    client_contact: project.phone,
    description: `Handed off from Sales project ${project.id}.`,
    department_id: departmentId,
    department_name: '',
    project_type: 'department',
    department_ids: [departmentId],
    department_names: [],
    project_manager_id: '',
    project_manager_name: '',
    team_member_ids: [assignedPerson.id],
    team_member_names: [],
    start_date: '',
    estimated_close_date: '',
    actual_close_date: '',
    deadline: '',
    budget: 0,
    status: 'planning',
    priority: project.priority,
    progress_percent: 0,
    remarks: '',
    attachments: [],
    updated_at: ''
  };
  const created = await tmsProjectStore.create(draft);
  await projectStore.update(project.id, { tms_project_id: created.id });
}

// The other direction of the same bridge: once a technical person has been
// assigned (above) and a TMS project exists, nothing else ever touches
// tms_projects again — so if the Sales deal is later closed as Lost, the TMS
// side has no way to know. Left alone, that project (and any tasks already
// raised under it) keeps counting as an "Active Project"/"Pending Task" on
// every TMS dashboard forever, since those are computed purely from
// tms_projects.status / tms_tasks.status, not from the linked Sales project's
// stage. Best-effort, same as syncTmsProjectForAssignment: every call site
// wraps this in try/catch so a TMS-side failure never blocks the Sales side
// from closing the deal.
export async function cancelTmsProjectForLostDeal(tmsProjectId: string): Promise<void> {
  if (!tmsProjectId) return;
  const tmsProject = await tmsProjectStore.findById(tmsProjectId);
  if (!tmsProject || tmsProject.status === 'completed' || tmsProject.status === 'cancelled') return;

  await tmsProjectStore.update(tmsProjectId, { status: 'cancelled' });
  await db.TmsTask.update(
    { status: 'cancelled' } as never,
    { where: { project_id: tmsProjectId, status: { [Op.notIn]: ['completed', 'cancelled'] } } as never }
  );
}
