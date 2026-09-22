import type { Model } from 'sequelize';
import { db, isUuid } from './db';
import { appendProjectTimeline, findProjectById, projectStore } from './projectStore';
import { findUserById } from './userStore';
import { listDepartmentManagers } from './departmentStore';
import { logAudit } from './auditLogStore';
import { notifyUsers } from './notificationStore';
import { sendProjectLifecycleEmail } from './email/notifications';
import { syncTmsProjectForAssignment } from './tmsHandoff';
import { ProjectRecord, ProjectTechnicalRequestRecord, ProjectTechnicalRequestView, UserRecord, UserRole } from './types';

// Technical-person approval for Sales projects.
//
// Picking a technical person used to assign them on the spot: an "A project
// was assigned to you" email, a TMS project with them on the team, and no say
// for the engineer or their manager — which is how an engineer could learn
// the evening before that they were due on site the next morning. Now the
// sales side raises a request, and only someone entitled to commit that
// engineer's time can turn it into an assignment:
//   - the engineer themselves,
//   - a manager of the engineer's department (Department.managerIds),
//   - an admin/superadmin (override, same as Demo Schedule's approvals).
// Those same people still assign directly — they ARE the approval. Everyone
// else (sales reps, sales managers) goes through a request.

export interface Actor {
  userId: string;
  username: string;
  name: string;
  role: string;
}

export class TechnicalRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const ADMIN_ROLES = ['admin', 'superadmin'];
const isAdmin = (role: string) => ADMIN_ROLES.includes(role);

async function managesDepartment(username: string, department: string): Promise<boolean> {
  if (!department) return false;
  const managers = (await listDepartmentManagers())[department] || [];
  return managers.some((m) => m.username === username);
}

// May this actor commit this person's time — i.e. approve a request for
// them, or assign them without one?
export async function canApproveFor(actor: Actor, person: Pick<UserRecord, 'id' | 'department'>): Promise<boolean> {
  return actor.userId === person.id || isAdmin(actor.role) || managesDepartment(actor.username, person.department);
}

// May this actor send someone else in their place? Only a manager of that
// person's department (their own team) or an admin — an engineer approving
// their own request can only say yes or no for themselves.
async function canAllocateFrom(actor: Actor, person: Pick<UserRecord, 'department'>): Promise<boolean> {
  return isAdmin(actor.role) || managesDepartment(actor.username, person.department);
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const INCLUDES = () => [
  { model: db.User, as: 'requestedUser', attributes: ['id', 'username', 'name', 'department'] },
  { model: db.User, as: 'requestedBy', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'decidedBy', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'assignedUser', attributes: ['id', 'username', 'name'] }
];

type Person = { id?: string; username?: string; name?: string; department?: string } | null;

function toRecord(row: Model): ProjectTechnicalRequestRecord {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const requested = p.requestedUser as Person;
  const by = p.requestedBy as Person;
  const decided = p.decidedBy as Person;
  const assigned = p.assignedUser as Person;
  return {
    id: p.id as string,
    project_id: p.project_id as string,
    requested_user_id: p.requested_user_id as string,
    requested_name: requested?.name || requested?.username || '',
    requested_username: requested?.username || '',
    requested_department: requested?.department || '',
    requested_by_id: p.requested_by_id as string,
    requested_by_name: by?.name || by?.username || '',
    requested_by_username: by?.username || '',
    status: p.status as ProjectTechnicalRequestRecord['status'],
    note: (p.note as string) || '',
    needed_by: (p.needed_by as string) || '',
    decided_by_name: decided?.name || decided?.username || '',
    decided_at: isoOrEmpty(p.decided_at),
    assigned_user_id: (p.assigned_user_id as string) || '',
    assigned_name: assigned?.name || assigned?.username || '',
    response_remarks: (p.response_remarks as string) || '',
    created_at: isoOrEmpty(p.createdAt ?? p.created_at)
  };
}

export async function findPendingTechnicalRequest(projectId: string) {
  if (!isUuid(projectId)) return null;
  const row = await db.ProjectTechnicalRequest.findOne({ where: { project_id: projectId, status: 'pending' } as never, include: INCLUDES() });
  return row ? toRecord(row) : null;
}

function projectLabel(project: Pick<ProjectRecord, 'client_name' | 'company'>): string {
  return project.client_name || project.company || 'Project';
}

function formatNeededBy(date: string): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The single place a technical person actually lands on a project — used for
// a direct assignment by someone entitled to make it, and for an approved
// request. Everything that used to fire on the spot (timeline, audit,
// notification + email to the engineer, TMS project) now fires only here.
export async function applyTechnicalAssignment(project: ProjectRecord, person: UserRecord, actor: Actor, ip: string, via?: string): Promise<ProjectRecord | null> {
  const updated = await projectStore.update(project.id, { assigned_technical_person_id: person.id, updated_at: new Date().toISOString() });
  const previousName = project.assigned_technical_person_name || 'Unassigned';
  await appendProjectTimeline(project.id, {
    by: actor.username,
    stage: project.stage,
    label: `Assigned technical person: ${previousName} → ${person.name}`,
    remarks: via || ''
  });
  await logAudit({
    by: actor.username,
    role: actor.role as UserRole,
    entityType: 'project',
    entityId: project.id,
    action: 'Project reassigned',
    previousStatus: previousName,
    newStatus: person.name,
    remarks: [projectLabel(project), via].filter(Boolean).join(' — '),
    ip
  });
  // Someone assigning themselves already knows.
  if (person.id !== actor.userId) {
    await notifyUsers([person.username], {
      title: 'A project was assigned to you',
      body: `${projectLabel(project)} — assigned as the technical lead${via ? ` (${via})` : ''}`,
      type: 'project_assigned',
      entityType: 'project',
      entityId: project.id
    });
    void sendProjectLifecycleEmail({
      name: person.name,
      email: person.email,
      projectId: project.id,
      projectKind: 'sales',
      event: 'assigned',
      projectLabel: projectLabel(project),
      detail: via
    });
  }
  try {
    await syncTmsProjectForAssignment(updated ?? project, person, actor.username);
  } catch {
    // Best-effort — the assignment above already succeeded either way.
  }
  return updated;
}

export type TechnicalRequestResult =
  | { mode: 'assigned'; project: ProjectRecord | null }
  | { mode: 'requested'; request: ProjectTechnicalRequestRecord };

// Picking a technical person on a project. Assigns straight away when the
// actor may commit that person's time; otherwise raises a request for the
// engineer and their department manager(s) to approve. A newer pick replaces
// any request still waiting.
export async function requestTechnicalPerson(
  project: ProjectRecord,
  personId: string,
  actor: Actor,
  input: { note: string; neededBy: string },
  ip: string
): Promise<TechnicalRequestResult> {
  const person = isUuid(personId) ? await findUserById(personId) : undefined;
  if (!person || person.status !== 'active') throw new TechnicalRequestError('That person is not an active user.', 400);
  const pending = await findPendingTechnicalRequest(project.id);
  if (person.id === project.assigned_technical_person_id && !pending) {
    throw new TechnicalRequestError(`${person.name} is already the technical person on this project.`, 400);
  }
  if (input.neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(input.neededBy)) throw new TechnicalRequestError('Needed-by must be a date.', 400);

  if (await canApproveFor(actor, person)) {
    if (pending && (await closeRequest(pending.id, 'withdrawn', actor, `Replaced — ${person.name} assigned directly`))) {
      await notifyRequestWithdrawn(pending.requested_username, project, actor);
    }
    const updated = await applyTechnicalAssignment(project, person, actor, ip);
    return { mode: 'assigned', project: updated };
  }

  const approvers = [person.username, ...((await listDepartmentManagers())[person.department] || []).map((m) => m.username)];
  let requestId = '';
  try {
    await db.sequelize.transaction(async (transaction) => {
      if (pending) {
        await db.ProjectTechnicalRequest.update(
          { status: 'withdrawn', decided_by_id: actor.userId, decided_at: new Date(), response_remarks: `Replaced by a request for ${person.name}` } as never,
          { where: { id: pending.id, status: 'pending' } as never, transaction }
        );
      }
      const row = await db.ProjectTechnicalRequest.create(
        { project_id: project.id, requested_user_id: person.id, requested_by_id: actor.userId, note: input.note, needed_by: input.neededBy || null } as never,
        { transaction }
      );
      requestId = row.get('id') as string;
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
      throw new TechnicalRequestError('Someone else just requested a technical person for this project — refresh to see it.', 409);
    }
    throw error;
  }
  const request = toRecord((await db.ProjectTechnicalRequest.findByPk(requestId, { include: INCLUDES() }))!);
  if (pending && pending.requested_user_id !== person.id) await notifyRequestWithdrawn(pending.requested_username, project, actor);

  const neededBy = formatNeededBy(input.neededBy);
  await appendProjectTimeline(project.id, {
    by: actor.username,
    stage: project.stage,
    label: `Technical person requested: ${person.name} — awaiting approval`,
    remarks: [neededBy && `Needed by ${neededBy}`, input.note].filter(Boolean).join(' · ')
  });
  await logAudit({
    by: actor.username,
    role: actor.role as UserRole,
    entityType: 'project',
    entityId: project.id,
    action: `Technical person requested: ${person.name}`,
    previousStatus: project.assigned_technical_person_name || 'Unassigned',
    newStatus: 'pending_technical_approval',
    remarks: input.note,
    ip
  });

  const recipients = [...new Set(approvers)].filter((u) => u !== actor.username);
  await notifyUsers(recipients, {
    title: 'Technical assignment needs your approval',
    body: `${actor.name} requested ${person.name} for ${projectLabel(project)}${neededBy ? ` — needed by ${neededBy}` : ''}. Nothing is assigned until approved.`,
    type: 'project_technical_request',
    entityType: 'project',
    entityId: project.id
  });
  const detail = [
    `Requested: ${person.name}${person.department ? ` (${person.department})` : ''}`,
    `Requested by: ${actor.name}`,
    ...(neededBy ? [`Needed on site by: ${neededBy}`] : []),
    ...(input.note ? [`Note: ${input.note}`] : [])
  ].join('\n');
  const recipientUsers = await db.User.findAll({ where: { username: recipients } as never, attributes: ['name', 'email'] });
  for (const u of recipientUsers) {
    const email = u.get('email') as string;
    if (email) void sendProjectLifecycleEmail({ name: u.get('name') as string, email, projectId: project.id, projectKind: 'sales', event: 'technical_requested', projectLabel: projectLabel(project), detail });
  }

  return { mode: 'requested', request };
}

// Flips a pending request to its final state, only if it's still pending —
// two approvers acting at once can't both win.
async function closeRequest(id: string, status: 'approved' | 'declined' | 'withdrawn', actor: Actor, remarks: string, assignedUserId?: string): Promise<boolean> {
  const [count] = await db.ProjectTechnicalRequest.update(
    { status, decided_by_id: actor.userId, decided_at: new Date(), response_remarks: remarks, assigned_user_id: assignedUserId || null } as never,
    { where: { id, status: 'pending' } as never }
  );
  return count > 0;
}

export async function decideTechnicalRequest(
  projectId: string,
  requestId: string,
  actor: Actor,
  input: { decision: 'approve' | 'decline'; remarks: string; assignUserId: string },
  ip: string
): Promise<ProjectRecord | null> {
  const pending = await findPendingTechnicalRequest(projectId);
  if (!pending || pending.id !== requestId) throw new TechnicalRequestError('This request has already been answered or withdrawn.', 409);
  const project = await findProjectById(projectId);
  if (!project) throw new TechnicalRequestError('Project not found', 404);
  const requested = await findUserById(pending.requested_user_id);
  if (!requested || !(await canApproveFor(actor, requested))) {
    throw new TechnicalRequestError(`Only ${pending.requested_name}, their department manager, or an admin can answer this request.`, 403);
  }
  const requester = await findUserById(pending.requested_by_id);

  if (input.decision === 'decline') {
    if (!input.remarks) throw new TechnicalRequestError('Give a reason so the sales team knows what to do next.', 400);
    if (!(await closeRequest(pending.id, 'declined', actor, input.remarks))) throw new TechnicalRequestError('This request has already been answered.', 409);
    await appendProjectTimeline(projectId, { by: actor.username, stage: project.stage, label: `Technical request for ${pending.requested_name} declined by ${actor.name}`, remarks: input.remarks });
    await logAudit({ by: actor.username, role: actor.role as UserRole, entityType: 'project', entityId: projectId, action: `Technical request declined: ${pending.requested_name}`, previousStatus: 'pending_technical_approval', newStatus: 'declined', remarks: input.remarks, ip });
    if (requester && requester.id !== actor.userId) {
      await notifyUsers([requester.username], {
        title: 'Technical person request declined',
        body: `${actor.name} declined ${pending.requested_name} for ${projectLabel(project)}: ${input.remarks}`,
        type: 'project_technical_declined',
        entityType: 'project',
        entityId: projectId
      });
      void sendProjectLifecycleEmail({ name: requester.name, email: requester.email, projectId, projectKind: 'sales', event: 'technical_declined', projectLabel: projectLabel(project), detail: `Requested: ${pending.requested_name}\nDeclined by: ${actor.name}\nReason: ${input.remarks}` });
    }
    return project;
  }

  // Approve — possibly with someone else from the same team.
  let assignee = requested;
  if (input.assignUserId && input.assignUserId !== requested.id) {
    const alternative = isUuid(input.assignUserId) ? await findUserById(input.assignUserId) : undefined;
    if (!alternative || alternative.status !== 'active') throw new TechnicalRequestError('The person you picked is not an active user.', 400);
    if (!(await canAllocateFrom(actor, requested)) || !(await canAllocateFrom(actor, alternative))) {
      throw new TechnicalRequestError('Only a department manager or admin can send someone else, and only from their own team.', 403);
    }
    assignee = alternative;
  }
  if (!(await closeRequest(pending.id, 'approved', actor, input.remarks, assignee.id))) throw new TechnicalRequestError('This request has already been answered.', 409);

  const via = assignee.id === requested.id
    ? `Approved by ${actor.name}`
    : `Approved by ${actor.name} — sent instead of ${requested.name}`;
  const updated = await applyTechnicalAssignment(project, assignee, actor, ip, via);
  if (requester && requester.id !== actor.userId) {
    await notifyUsers([requester.username], {
      title: 'Technical person approved',
      body: `${assignee.name} is now the technical person for ${projectLabel(project)} (${via.toLowerCase()}).`,
      type: 'project_technical_approved',
      entityType: 'project',
      entityId: projectId
    });
    void sendProjectLifecycleEmail({
      name: requester.name, email: requester.email, projectId, projectKind: 'sales', event: 'technical_approved', projectLabel: projectLabel(project),
      detail: [`Assigned: ${assignee.name}`, via, ...(input.remarks ? [`Remarks: ${input.remarks}`] : [])].join('\n')
    });
  }
  return updated;
}

export async function withdrawTechnicalRequest(projectId: string, actor: Actor, ip: string): Promise<void> {
  const pending = await findPendingTechnicalRequest(projectId);
  if (!pending) throw new TechnicalRequestError('There is no pending request to withdraw.', 409);
  const project = await findProjectById(projectId);
  if (!project) throw new TechnicalRequestError('Project not found', 404);
  if (!(await closeRequest(pending.id, 'withdrawn', actor, ''))) throw new TechnicalRequestError('This request has already been answered.', 409);
  await appendProjectTimeline(projectId, { by: actor.username, stage: project.stage, label: `Technical request for ${pending.requested_name} withdrawn` });
  await logAudit({ by: actor.username, role: actor.role as UserRole, entityType: 'project', entityId: projectId, action: `Technical request withdrawn: ${pending.requested_name}`, previousStatus: 'pending_technical_approval', newStatus: 'withdrawn', ip });
  await notifyRequestWithdrawn(pending.requested_username, project, actor);
}

// So the engineer doesn't act on a request that no longer exists.
async function notifyRequestWithdrawn(requestedUsername: string, project: ProjectRecord, actor: Actor): Promise<void> {
  if (!requestedUsername || requestedUsername === actor.username) return;
  await notifyUsers([requestedUsername], {
    title: 'Technical request withdrawn',
    body: `The request for you on ${projectLabel(project)} was withdrawn — no action needed.`,
    type: 'project_technical_withdrawn',
    entityType: 'project',
    entityId: project.id
  });
}

// The pending request, with what this viewer may do about it.
export async function getTechnicalRequestView(projectId: string, viewer: Actor & { isPrivileged: boolean }, projectCreatedBy: string): Promise<ProjectTechnicalRequestView | null> {
  const pending = await findPendingTechnicalRequest(projectId);
  if (!pending) return null;
  const requested = { id: pending.requested_user_id, department: pending.requested_department };
  const [canDecide, canReassign] = await Promise.all([canApproveFor(viewer, requested), canAllocateFrom(viewer, requested)]);
  return {
    ...pending,
    can_decide: canDecide,
    can_reassign: canReassign,
    can_withdraw: viewer.isPrivileged || viewer.username === projectCreatedBy || viewer.userId === pending.requested_by_id
  };
}

// Someone asked to approve must be able to open the project to decide — even
// though, not being assigned yet, the normal visibility rules hide it.
export async function canViewForPendingRequest(projectId: string, viewer: Actor): Promise<boolean> {
  const pending = await findPendingTechnicalRequest(projectId);
  return !!pending && canApproveFor(viewer, { id: pending.requested_user_id, department: pending.requested_department });
}

// Requests waiting on this viewer (as the engineer or their department
// manager) — the Dashboard's "Needs your attention". Admins can answer any
// request but aren't asked to, so they're not included here.
export async function listTechnicalRequestsAwaiting(viewer: Actor): Promise<{ project_id: string; project_label: string; requested_name: string }[]> {
  const managed = Object.entries(await listDepartmentManagers())
    .filter(([, managers]) => managers.some((m) => m.username === viewer.username))
    .map(([department]) => department);
  const rows = await db.ProjectTechnicalRequest.findAll({
    where: { status: 'pending' } as never,
    include: [...INCLUDES(), { model: db.Project, as: 'project', attributes: ['id', 'client_name', 'company'] }],
    order: [['created_at', 'ASC']]
  });
  return rows
    .map((row) => ({ record: toRecord(row), project: (row.get({ plain: true }) as { project?: { client_name?: string; company?: string } }).project }))
    .filter(({ record }) => record.requested_user_id === viewer.userId || managed.includes(record.requested_department))
    .map(({ record, project }) => ({ project_id: record.project_id, project_label: project?.client_name || project?.company || 'Project', requested_name: record.requested_name }));
}
