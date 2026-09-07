import { Model, Op } from 'sequelize';
import { db, isUuid } from './db';
import { ViewerContext } from './viewerContext';
import { resolveVisibilityScope } from './departmentScope';
import { GeneralTaskPriority, GeneralTaskRecord, GeneralTaskStatus, GeneralTaskUpdateRecord, GeneralTaskSourceModule } from './types';

const FIELDS = [
  { name: 'source_module' },
  { name: 'title' },
  { name: 'description' },
  { name: 'department_id' },
  { name: 'assignee_id' },
  { name: 'reviewer_id', kind: 'nullable' as const },
  { name: 'priority' },
  { name: 'status' },
  { name: 'requires_review', kind: 'bool' as const },
  { name: 'category', kind: 'nullable' as const },
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'start_date', kind: 'nullable' as const },
  { name: 'deadline' },
  { name: 'remarks' },
  { name: 'attachments', kind: 'json' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const ALL_INCLUDES = [
  { model: db.User, as: 'creator', attributes: ['id', 'username'] },
  { model: db.User, as: 'assignee', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'reviewer', attributes: ['id', 'username', 'name'] },
  { model: db.Department, as: 'department', attributes: ['id', 'name'] },
  { model: db.Project, as: 'project', attributes: ['id', 'client_name', 'company'] }
];

function toRecord(row: Model): GeneralTaskRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const assignee = plain.assignee as { name?: string; username?: string } | null;
  const reviewer = plain.reviewer as { name?: string; username?: string } | null;
  const project = plain.project as { client_name?: string; company?: string } | null;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
    assignee_name: assignee?.name ?? '',
    assignee_username: assignee?.username ?? '',
    reviewer_name: reviewer?.name ?? '',
    reviewer_username: reviewer?.username ?? '',
    project_name: project ? project.client_name || project.company || '' : '',
    updated_at: isoOrEmpty(plain.updatedAt),
    recurrence_template_id: (plain.recurrence_template_id as string) ?? '',
    recurrence_period_key: (plain.recurrence_period_key as string) ?? ''
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'bool') record[name] = !!raw;
    else if (kind === 'json') record[name] = raw ?? [];
    else record[name] = raw ?? '';
  }
  return record as unknown as GeneralTaskRecord;
}

// Row-level visibility, reusing the SAME org-wide/department-scope/own-only
// resolver every other non-TMS module already uses (lib/departmentScope.ts)
// — deliberately NOT a bespoke tiering like TMS's, since a GeneralTask can
// belong to ANY department, not a fixed set of 4.
async function list(viewer: ViewerContext, filters: { sourceModule?: GeneralTaskSourceModule } = {}): Promise<GeneralTaskRecord[]> {
  const scope = await resolveVisibilityScope(viewer.username);
  const where: Record<string | symbol, unknown> = {};
  if (filters.sourceModule) where.source_module = filters.sourceModule;
  if (!scope.seesOrgWide) {
    const ids = scope.scopedUserIds ?? [];
    where[Op.or as unknown as string] = [{ assignee_id: { [Op.in]: ids } }, { created_by: { [Op.in]: ids } }];
  }
  const rows = await db.GeneralTask.findAll({ where: where as never, include: ALL_INCLUDES, order: [['deadline', 'ASC']] });
  return rows.map(toRecord);
}

// Every task assigned to this exact user (their unified "My Tasks" inbox,
// admin- and hr-sourced alike) — deliberately not also matching created_by,
// same reasoning as tmsTaskStore.ts's listForAssignee.
async function listForAssignee(userId: string): Promise<GeneralTaskRecord[]> {
  if (!isUuid(userId)) return [];
  const rows = await db.GeneralTask.findAll({ where: { assignee_id: userId } as never, include: ALL_INCLUDES, order: [['deadline', 'ASC']] });
  return rows.map(toRecord);
}

async function findById(id: string): Promise<GeneralTaskRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.GeneralTask.findByPk(id, { include: ALL_INCLUDES });
  return row ? toRecord(row) : undefined;
}

// Re-derives the same scope list() uses for a single row — needed because
// the [id] routes fetch directly by id, bypassing list()'s filtering. Every
// [id] route MUST call this before returning/mutating a task (this is the
// exact class of bug that had to be fixed after the fact in the TMS work —
// built in from the start here instead).
export async function canAccessGeneralTaskRow(
  viewer: ViewerContext,
  task: Pick<GeneralTaskRecord, 'assignee_id' | 'created_by' | 'reviewer_id'>,
  scope?: Awaited<ReturnType<typeof resolveVisibilityScope>>
): Promise<boolean> {
  const resolvedScope = scope ?? (await resolveVisibilityScope(viewer.username));
  if (resolvedScope.seesOrgWide) return true;
  if (task.created_by === viewer.username) return true;
  if (task.reviewer_id === viewer.userId) return true;
  const ids = resolvedScope.scopedUserIds ?? [];
  return ids.includes(task.assignee_id);
}

// Broader than canAccessGeneralTaskRow: "may this viewer manage this task's
// workflow" (edit fields, reassign, extend deadline, cancel) — the task's
// own creator, its reviewer, a manager of the ASSIGNEE's department
// (explicitly excluding the assignee themself, who only gets the narrower
// assignee-action endpoint), or a privileged/org-wide viewer.
export async function canManageGeneralTask(viewer: ViewerContext, task: Pick<GeneralTaskRecord, 'assignee_id' | 'created_by' | 'reviewer_id'>): Promise<boolean> {
  if (viewer.isPrivileged) return true;
  if (task.created_by === viewer.username) return true;
  if (task.reviewer_id === viewer.userId) return true;
  const scope = await resolveVisibilityScope(viewer.username);
  if (scope.seesOrgWide) return true;
  if (viewer.userId !== task.assignee_id && (scope.scopedUserIds ?? []).includes(task.assignee_id)) return true;
  return false;
}

async function create(input: {
  sourceModule: GeneralTaskSourceModule;
  title: string;
  description: string;
  departmentId: string;
  assigneeId: string;
  reviewerId?: string;
  priority: GeneralTaskPriority;
  requiresReview: boolean;
  category?: string;
  projectId?: string;
  startDate?: string;
  deadline: string;
  remarks?: string;
  attachments?: string[];
  createdByUsername: string;
  recurrenceTemplateId?: string;
  recurrencePeriodKey?: string;
}): Promise<GeneralTaskRecord> {
  const creator = await db.User.findOne({ where: { username: input.createdByUsername } as never, attributes: ['id'] });
  const row = await db.GeneralTask.create(
    {
      source_module: input.sourceModule,
      title: input.title,
      description: input.description || '',
      department_id: input.departmentId,
      assignee_id: input.assigneeId,
      reviewer_id: input.reviewerId || (creator ? creator.get('id') : null),
      created_by: creator ? creator.get('id') : null,
      priority: input.priority,
      status: 'pending',
      requires_review: input.requiresReview,
      category: input.category || null,
      project_id: input.projectId || null,
      start_date: input.startDate || null,
      deadline: input.deadline,
      remarks: input.remarks || '',
      attachments: input.attachments || [],
      recurrence_template_id: input.recurrenceTemplateId || null,
      recurrence_period_key: input.recurrencePeriodKey || null
    } as never
  );
  const withAssoc = await db.GeneralTask.findByPk(row.get('id') as string, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

async function update(id: string, patch: Record<string, unknown>): Promise<GeneralTaskRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.GeneralTask.findByPk(id);
  if (!row) return null;
  await row.update(patch as never);
  const withAssoc = await db.GeneralTask.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

export const generalTaskStore = { list, listForAssignee, findById, create, update };

// --- Status transitions ------------------------------------------------

export type GeneralTaskAction = 'start' | 'submit' | 'approve' | 'rework' | 'reject' | 'reopen' | 'cancel';

const ASSIGNEE_TRANSITIONS: Record<GeneralTaskStatus, GeneralTaskAction[]> = {
  pending: ['start'],
  in_progress: ['submit'],
  under_review: [],
  rework_required: ['reopen'],
  approved: [],
  rejected: [],
  cancelled: [],
  completed: []
};

export function isValidAssigneeTransition(status: GeneralTaskStatus, action: GeneralTaskAction): boolean {
  return (ASSIGNEE_TRANSITIONS[status] || []).includes(action);
}

// Reviewer actions are only meaningful from 'under_review' — enforced by the
// caller checking task.status === 'under_review' before invoking these.
export const REVIEWER_ACTIONS: GeneralTaskAction[] = ['approve', 'rework', 'reject'];

function toUpdateRecord(row: Model): GeneralTaskUpdateRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const updatedBy = plain.updatedBy as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    taskId: plain.task_id as string,
    statusAtUpdate: plain.status_at_update as GeneralTaskStatus,
    workSummary: (plain.work_summary as string) ?? '',
    remarks: (plain.remarks as string) ?? '',
    attachments: Array.isArray(plain.attachments) ? (plain.attachments as string[]) : [],
    updatedByName: updatedBy?.name ?? updatedBy?.username ?? '',
    updatedByUsername: updatedBy?.username ?? '',
    createdAt: isoOrEmpty(plain.created_at)
  };
}

export async function listTaskUpdates(taskId: string): Promise<GeneralTaskUpdateRecord[]> {
  if (!isUuid(taskId)) return [];
  const rows = await db.GeneralTaskUpdate.findAll({
    where: { task_id: taskId } as never,
    include: [{ model: db.User, as: 'updatedBy', attributes: ['id', 'username', 'name'] }],
    order: [['created_at', 'DESC']]
  });
  return rows.map(toUpdateRecord);
}

export interface RecordTaskUpdateInput {
  taskId: string;
  status: GeneralTaskStatus;
  workSummary?: string;
  remarks?: string;
  attachments?: string[];
  updatedByUserId: string;
}

export async function recordTaskUpdate(input: RecordTaskUpdateInput): Promise<GeneralTaskRecord | null> {
  await db.GeneralTaskUpdate.create({
    task_id: input.taskId,
    status_at_update: input.status,
    work_summary: input.workSummary || '',
    remarks: input.remarks || '',
    attachments: input.attachments || [],
    updated_by: input.updatedByUserId
  } as never);
  return update(input.taskId, { status: input.status });
}
