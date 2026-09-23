import { db, isUuid } from './db';
import { appendProjectTimeline, canAccessProject, findProjectById, reassignProjectOwner } from './projectStore';
import { findUserById } from './userStore';
import { projectHandoverStore } from './projectHandoverStore';
import { logAudit } from './auditLogStore';
import { notifyUsers } from './notificationStore';
import { sendProjectLifecycleEmail } from './email/notifications';
import { isTechnicalRole, SALES_DEPARTMENTS } from './technicalRoles';
import { ProjectRecord, UserRecord, UserRole } from './types';

// A Sales project's sales person is its OWNER (created_by) — that's what puts
// it in their pipeline, dashboard, KPIs, follow-ups and department health.
// The sales_person column is only a label. Technical staff may create a
// project and hand it to a sales person (and fix the pick later on a
// project they originated); admins keep their existing tools (Assign Team,
// Handover) and may use this too.

export interface SalesOwnerActor {
  userId: string;
  username: string;
  name: string;
  role: string;
  isPrivileged: boolean;
}

export class SalesOwnerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function isSalesPersonCandidate(user: Pick<UserRecord, 'status' | 'department'>): boolean {
  return user.status === 'active' && SALES_DEPARTMENTS.includes(user.department);
}

// Resolves and validates the sales person picked for a project.
export async function findSalesPersonCandidate(userId: string): Promise<UserRecord> {
  const user = isUuid(userId) ? await findUserById(userId) : undefined;
  if (!user) throw new SalesOwnerError('Pick the sales person this project is for.', 400);
  if (!isSalesPersonCandidate(user)) throw new SalesOwnerError(`${user.name || user.username} is not an active member of Sales, so can't own a sales project.`, 400);
  return user;
}

// Who created the project in the first place — the timeline's "created"
// event, which POST /api/projects always writes with the creator's username.
// created_by can't answer this once ownership has moved to a sales person.
export async function findProjectOriginator(projectId: string): Promise<string> {
  if (!isUuid(projectId)) return '';
  const row = await db.ProjectTimelineEvent.findOne({ where: { project_id: projectId, stage: 'created' } as never, order: [['at', 'ASC']], attributes: ['by'] });
  return row ? ((row.get('by') as string) || '') : '';
}

// Admins always; technical staff on a project they own or created — never on
// someone else's project they merely work on as its engineer. Closed
// (won/lost) projects keep their sales owner, since won/lost credit follows it.
// Having created it only counts while the creator is still on the project:
// once they've been replaced as its technical person (or it's otherwise out
// of their reach), they can't keep moving it between sales people.
export async function canAssignSalesPerson(actor: SalesOwnerActor, project: Pick<ProjectRecord, 'id' | 'created_by' | 'status' | 'assigned_technical_person_id'>): Promise<boolean> {
  if (actor.isPrivileged) return true;
  if (!isTechnicalRole(actor.role)) return false;
  if (project.status === 'won' || project.status === 'lost') return false;
  if (project.created_by === actor.username) return true;
  if ((await findProjectOriginator(project.id)) !== actor.username) return false;
  return project.assigned_technical_person_id === actor.userId || canAccessProject(actor.username, project);
}

function projectLabel(project: Pick<ProjectRecord, 'client_name' | 'company'>): string {
  return project.client_name || project.company || 'Project';
}

// In-app + email to the sales person a project was just handed to.
export async function notifySalesPersonAssigned(project: Pick<ProjectRecord, 'id' | 'client_name' | 'company'>, salesPerson: UserRecord, actor: { username: string; name: string }): Promise<void> {
  if (salesPerson.username === actor.username) return;
  await notifyUsers([salesPerson.username], {
    title: 'A project was assigned to you',
    body: `${actor.name} assigned you as the sales person for ${projectLabel(project)}.`,
    type: 'project_sales_assigned',
    entityType: 'project',
    entityId: project.id
  });
  void sendProjectLifecycleEmail({
    name: salesPerson.name,
    email: salesPerson.email,
    projectId: project.id,
    projectKind: 'sales',
    event: 'sales_assigned',
    projectLabel: projectLabel(project),
    detail: `Assigned by: ${actor.name}`
  });
}

// Moves the project to a new sales owner (created_by + sales_person).
export async function assignSalesPerson(projectId: string, salesPersonId: string, actor: SalesOwnerActor, ip: string): Promise<ProjectRecord | undefined> {
  const project = await findProjectById(projectId);
  if (!project) throw new SalesOwnerError('Project not found', 404);
  if (!(await canAssignSalesPerson(actor, project))) {
    throw new SalesOwnerError(
      project.status === 'won' || project.status === 'lost'
        ? 'This project is closed — its sales person can no longer be changed.'
        : 'Only an admin, or the technical person who created this project, can assign its sales person.',
      403
    );
  }
  const salesPerson = await findSalesPersonCandidate(salesPersonId);
  if (project.created_by === salesPerson.username) throw new SalesOwnerError(`${salesPerson.name} is already the sales person on this project.`, 400);
  // A handover still waiting for an answer would, once accepted, silently
  // overwrite the owner set here — so it has to be settled first.
  const pendingHandover = await projectHandoverStore.findPendingForProject(projectId);
  if (pendingHandover) {
    throw new SalesOwnerError(`A handover to ${pendingHandover.to_name || pendingHandover.to_username} is pending on this project — it has to be accepted, declined or cancelled first.`, 409);
  }

  const previousOwner = project.created_by;
  await reassignProjectOwner(projectId, salesPerson.id);
  await appendProjectTimeline(projectId, {
    by: actor.username,
    stage: project.stage,
    label: `Sales person assigned: ${project.sales_person || previousOwner || 'None'} → ${salesPerson.name}`
  });
  await logAudit({
    by: actor.username,
    role: actor.role as UserRole,
    entityType: 'project',
    entityId: projectId,
    action: 'Sales person assigned',
    previousStatus: previousOwner || 'none',
    newStatus: salesPerson.username,
    remarks: projectLabel(project),
    ip
  });
  await notifySalesPersonAssigned(project, salesPerson, actor);
  // The person it was taken from shouldn't find out by it vanishing.
  if (previousOwner && previousOwner !== actor.username && previousOwner !== salesPerson.username) {
    await notifyUsers([previousOwner], {
      title: 'Project reassigned',
      body: `${actor.name} made ${salesPerson.name} the sales person for ${projectLabel(project)}.`,
      type: 'project_sales_reassigned',
      entityType: 'project',
      entityId: projectId
    });
  }
  return findProjectById(projectId);
}
