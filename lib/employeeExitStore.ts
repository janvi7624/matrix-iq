import { Op } from 'sequelize';
import { db, isUuid, sequelize } from './db';
import { reassignProjectOwner } from './projectStore';
import { reassignQuotationOwner } from './quotationStore';
import { updateUser } from './userStore';
import { logAudit } from './auditLogStore';
import { notifyUsers } from './notificationStore';
import { UserRole } from './types';

// "Currently open" scoping, applied consistently across the summary and the
// commit path so a manager never reassigns (or is shown) more than what's
// actually still outstanding — historical/closed records intentionally keep
// their original employee (spec: "do not change ownership of historical/
// closed records unnecessarily"):
//   Projects:    status NOT IN ('won','lost')      -- not yet closed either way
//   Tasks:       status NOT IN ('completed','cancelled')
//   Leads:       project_id IS NULL                -- not yet converted
//   Quotations:  status IN ('draft','sent')        -- not yet approved/rejected

export interface ExitWorkItem {
  id: string;
  label: string;
  status: string;
}

export interface WorkSummary {
  projects: ExitWorkItem[];
  tasks: ExitWorkItem[];
  leads: ExitWorkItem[];
  quotations: (ExitWorkItem & { total: number })[];
}

export async function getAssignedWorkSummary(userId: string): Promise<WorkSummary> {
  if (!isUuid(userId)) return { projects: [], tasks: [], leads: [], quotations: [] };

  const [projectRows, taskRows, leadRows, quotationRows] = await Promise.all([
    db.Project.findAll({
      where: { created_by: userId, status: { [Op.notIn]: ['won', 'lost'] } } as never,
      attributes: ['id', 'client_name', 'company', 'status', 'stage']
    }),
    db.TmsTask.findAll({
      where: { assignee_id: userId, status: { [Op.notIn]: ['completed', 'cancelled'] } } as never,
      include: [{ model: db.TmsProject, as: 'project', attributes: ['name'] }],
      attributes: ['id', 'name', 'status']
    }),
    db.Lead.findAll({
      where: { assigned_to_id: userId, project_id: null } as never,
      attributes: ['id', 'name', 'company']
    }),
    db.Quotation.findAll({
      where: { created_by: userId, status: { [Op.in]: ['draft', 'sent'] } } as never,
      attributes: ['id', 'quotation_number', 'client_name', 'client_company', 'status', 'total']
    })
  ]);

  return {
    projects: projectRows.map((r) => {
      const p = r.get({ plain: true }) as Record<string, unknown>;
      return { id: p.id as string, label: (p.client_name as string) || (p.company as string) || `Project ${p.id}`, status: p.status as string };
    }),
    tasks: taskRows.map((r) => {
      const p = r.get({ plain: true }) as Record<string, unknown>;
      const project = p.project as { name?: string } | null;
      return { id: p.id as string, label: `${p.name}${project?.name ? ` (${project.name})` : ''}`, status: p.status as string };
    }),
    leads: leadRows.map((r) => {
      const p = r.get({ plain: true }) as Record<string, unknown>;
      return { id: p.id as string, label: (p.name as string) || (p.company as string) || `Lead ${p.id}`, status: 'open' };
    }),
    quotations: quotationRows.map((r) => {
      const p = r.get({ plain: true }) as Record<string, unknown>;
      return {
        id: p.id as string,
        label: `${p.quotation_number} — ${(p.client_name as string) || (p.client_company as string) || 'No client'}`,
        status: p.status as string,
        total: Number(p.total) || 0
      };
    })
  };
}

export interface EmployeeOption {
  id: string;
  username: string;
  name: string;
  department: string;
  designation: string;
}

// Active users only, optionally restricted to a department scope
// (scopeUserIds = null means org-wide). `excludeUserId` is always dropped —
// an inactive/exited employee can never be picked as their own replacement,
// and this also keeps a manager from accidentally "reassigning to self" when
// self happens to be the one exiting (shouldn't occur, but cheap to guard).
export async function listActiveEmployeesExcept(excludeUserId: string, scopeUserIds?: string[] | null): Promise<EmployeeOption[]> {
  const where: Record<string | symbol, unknown> = { status: 'active', id: { [Op.ne]: excludeUserId } };
  if (scopeUserIds) where.id = { [Op.and]: [{ [Op.ne]: excludeUserId }, { [Op.in]: scopeUserIds }] };

  const rows = await db.User.findAll({
    where: where as never,
    include: [{ model: db.Department, as: 'departmentRef', attributes: ['name'] }],
    attributes: ['id', 'username', 'name', 'designation']
  });
  return rows.map((r) => {
    const p = r.get({ plain: true }) as Record<string, unknown>;
    const dept = p.departmentRef as { name?: string } | null;
    return { id: p.id as string, username: p.username as string, name: (p.name as string) || (p.username as string), department: dept?.name ?? '', designation: (p.designation as string) ?? '' };
  });
}

export interface ReassignmentItem {
  id: string;
  newOwnerId: string;
}

export interface ReassignEmployeeWorkInput {
  exitingUserId: string;
  exitingUsername: string;
  actorUsername: string;
  actorRole: UserRole;
  projects: ReassignmentItem[];
  tasks: ReassignmentItem[];
  leads: ReassignmentItem[];
  quotations: ReassignmentItem[];
  setInactive?: boolean; // default true
}

export interface ReassignEmployeeWorkResult {
  reassignedCounts: { projects: number; tasks: number; leads: number; quotations: number };
  employeeStatus: 'active' | 'inactive';
}

export class ReassignmentValidationError extends Error {}

// Re-validates every submitted id actually belongs to the exiting user right
// now (not trusting the client's earlier summary fetch), runs every write in
// ONE transaction (a partial reassignment must never leave inconsistent
// ownership), then — outside the transaction, since neither is DB-critical —
// writes one audit-log line per record plus one notification per new owner,
// and finally marks the employee inactive.
export async function reassignEmployeeWork(input: ReassignEmployeeWorkInput): Promise<ReassignEmployeeWorkResult> {
  const current = await getAssignedWorkSummary(input.exitingUserId);

  const validate = (submitted: ReassignmentItem[], actual: ExitWorkItem[], kind: string) => {
    const actualIds = new Set(actual.map((a) => a.id));
    const submittedIds = new Set(submitted.map((s) => s.id));
    if (actualIds.size !== submittedIds.size || [...actualIds].some((id) => !submittedIds.has(id))) {
      throw new ReassignmentValidationError(`Submitted ${kind} reassignments do not match this employee's current open ${kind}`);
    }
    for (const s of submitted) {
      if (!isUuid(s.newOwnerId)) throw new ReassignmentValidationError(`Invalid new owner for ${kind} ${s.id}`);
    }
  };
  validate(input.projects, current.projects, 'projects');
  validate(input.tasks, current.tasks, 'tasks');
  validate(input.leads, current.leads, 'leads');
  validate(input.quotations, current.quotations, 'quotations');

  const actor = await db.User.findOne({ where: { username: input.actorUsername } as never, attributes: ['id'] });
  const actorId = actor ? (actor.get('id') as string) : null;

  await sequelize.transaction(async (t) => {
    for (const item of input.projects) await reassignProjectOwner(item.id, item.newOwnerId, { transaction: t });
    for (const item of input.tasks) await db.TmsTask.update({ assignee_id: item.newOwnerId } as never, { where: { id: item.id } as never, transaction: t });
    for (const item of input.leads) {
      await db.Lead.update(
        { assigned_to_id: item.newOwnerId, assigned_by_id: actorId, assigned_at: new Date() } as never,
        { where: { id: item.id } as never, transaction: t }
      );
    }
    for (const item of input.quotations) await reassignQuotationOwner(item.id, item.newOwnerId, { transaction: t });
  });

  // Audit trail + notifications — reuses the existing audit_logs table and
  // notification system rather than a parallel logging mechanism.
  const allItems: { kind: 'project' | 'tms_task' | 'lead' | 'quotation'; items: ReassignmentItem[]; labels: Map<string, string> }[] = [
    { kind: 'project', items: input.projects, labels: new Map(current.projects.map((p) => [p.id, p.label])) },
    { kind: 'tms_task', items: input.tasks, labels: new Map(current.tasks.map((p) => [p.id, p.label])) },
    { kind: 'lead', items: input.leads, labels: new Map(current.leads.map((p) => [p.id, p.label])) },
    { kind: 'quotation', items: input.quotations, labels: new Map(current.quotations.map((p) => [p.id, p.label])) }
  ];

  const newOwnerIds = new Set<string>();
  for (const group of allItems) for (const item of group.items) newOwnerIds.add(item.newOwnerId);
  const newOwners = await db.User.findAll({ where: { id: [...newOwnerIds] } as never, attributes: ['id', 'username'] });
  const usernameById = new Map(newOwners.map((u) => [u.get('id') as string, u.get('username') as string]));

  const notificationMeta: Record<string, { title: string; type: string }> = {
    project: { title: 'Project reassigned to you', type: 'project_reassigned' },
    tms_task: { title: 'Task reassigned to you', type: 'tms_task_reassigned' },
    lead: { title: 'Lead reassigned to you', type: 'lead_reassigned' },
    quotation: { title: 'Quotation reassigned to you', type: 'quotation_reassigned' }
  };

  for (const group of allItems) {
    for (const item of group.items) {
      const newOwnerUsername = usernameById.get(item.newOwnerId) ?? '';
      const label = group.labels.get(item.id) ?? item.id;
      await logAudit({
        by: input.actorUsername,
        role: input.actorRole,
        entityType: group.kind,
        entityId: item.id,
        action: 'reassigned',
        previousStatus: input.exitingUsername,
        newStatus: newOwnerUsername,
        remarks: `Reassigned from ${input.exitingUsername} (exit) to ${newOwnerUsername}: ${label}`
      });
      if (newOwnerUsername) {
        const meta = notificationMeta[group.kind];
        await notifyUsers([newOwnerUsername], { title: meta.title, body: `"${label}" was reassigned to you.`, type: meta.type, entityType: group.kind, entityId: item.id });
      }
    }
  }

  const reassignedCounts = {
    projects: input.projects.length,
    tasks: input.tasks.length,
    leads: input.leads.length,
    quotations: input.quotations.length
  };

  let employeeStatus: 'active' | 'inactive' = 'active';
  if (input.setInactive !== false) {
    await updateUser(input.exitingUserId, { status: 'inactive' });
    employeeStatus = 'inactive';
    await logAudit({
      by: input.actorUsername,
      role: input.actorRole,
      entityType: 'employee_exit',
      entityId: input.exitingUserId,
      action: 'exit_reassignment',
      previousStatus: 'active',
      newStatus: 'inactive',
      remarks: `Projects: ${reassignedCounts.projects}, Tasks: ${reassignedCounts.tasks}, Leads: ${reassignedCounts.leads}, Quotations: ${reassignedCounts.quotations}`
    });
  }

  return { reassignedCounts, employeeStatus };
}
