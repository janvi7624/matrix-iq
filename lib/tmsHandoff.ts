import { Op } from 'sequelize';
import { db } from './db';
import { tmsProjectStore, nextTmsProjectCode } from './tmsProjectStore';
import { projectStore } from './projectStore';
import { ProjectRecord, TmsProjectRecord, UserRecord } from './types';
import { findTmsProjectSetupNotifyTargets } from './tmsAccess';
import { notifyUsers } from './notificationStore';

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

  // Denormalized onto the TMS side so it never needs a join back to Sales
  // just to show who handed a project over (see the migration for why this
  // exists as structured columns instead of a sentence in `description`).
  const salesPersonUser = project.sales_person
    ? await db.User.findOne({ where: { username: project.sales_person } as never, attributes: ['name'] })
    : null;
  const salesPersonName = (salesPersonUser?.get('name') as string | undefined) || project.sales_person || '';

  if (project.tms_project_id) {
    const existing = await tmsProjectStore.findById(project.tms_project_id);
    if (existing) {
      const teamIds = new Set(existing.team_member_ids);
      teamIds.add(assignedPerson.id);
      await tmsProjectStore.update(existing.id, {
        department_id: departmentId,
        team_member_ids: Array.from(teamIds),
        // Only when nobody owns it yet. A technical manager may have taken
        // the project over already, and a later Sales-side assignment must
        // not silently seize it back from them.
        ...(existing.project_manager_id ? {} : { project_manager_id: assignedPerson.id }),
        sales_project_id: project.id,
        sales_person_name: salesPersonName,
        sales_person_username: project.sales_person
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
    sales_project_id: project.id,
    sales_person_name: salesPersonName,
    sales_person_username: project.sales_person,
    department_id: departmentId,
    department_name: '',
    project_type: 'department',
    department_ids: [departmentId],
    department_names: [],
    // The person Sales assigned owns it until a technical manager says
    // otherwise. Leaving this blank lost an answer Sales had already given.
    project_manager_id: assignedPerson.id,
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

  // A brand new TMS project from a Sales handoff starts with no plan, no
  // deadline and often no project manager set (only assignedPerson's own
  // "Needs Setup" visibility — a dashboard tile nobody is guaranteed to
  // check). At one or two handoffs a day that's fine; at the volume this
  // pipeline actually runs, silence here is how a project sits untouched for
  // weeks. So the department's manager-tier people and admins hear about it
  // the moment it's created, not only once someone happens to notice.
  try {
    const targets = await findTmsProjectSetupNotifyTargets(departmentId);
    const usernames = targets.map((t) => t.username).filter((u) => u !== actorUsername);
    await notifyUsers(usernames, {
      title: 'New project from Sales needs setup',
      body: `${draft.name} — handed to ${assignedPerson.name} by ${actorUsername}. Add a plan, deadline, and tasks.`,
      type: 'tms_project_needs_setup',
      entityType: 'tms_project',
      entityId: created.id
    });
  } catch {
    // Best-effort — the handoff above already succeeded either way.
  }
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
