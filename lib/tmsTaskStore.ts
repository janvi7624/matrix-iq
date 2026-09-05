import { Model, Op } from 'sequelize';
import { TmsTaskRecord, TmsTaskStatus, TmsTaskUpdateRecord } from './types';
import { db, isUuid } from './db';
import { canManageAllTmsTasks, TmsViewer } from './tmsAccess';
import { EngineerTaskAction } from './tmsLabels';

export type { EngineerTaskAction };

const FIELDS = [
  { name: 'project_id' },
  { name: 'name' },
  { name: 'assignee_id', kind: 'nullable' as const },
  { name: 'department_id', kind: 'nullable' as const },
  { name: 'description' },
  { name: 'priority' },
  { name: 'status' },
  { name: 'progress_percent', kind: 'number' as const },
  { name: 'start_date', kind: 'nullable' as const },
  { name: 'due_date', kind: 'nullable' as const },
  { name: 'completion_date', kind: 'nullable' as const },
  { name: 'remarks' },
  { name: 'attachments', kind: 'json' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable') return value === '' || value === undefined ? null : value;
  if (kind === 'number') return value === '' || value === undefined || value === null ? null : value;
  return value;
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const assigneeInclude = { model: db.User, as: 'assignee', attributes: ['id', 'name'] };
const deptInclude = { model: db.Department, as: 'department', attributes: ['id', 'name'] };
const projectInclude = { model: db.TmsProject, as: 'project', attributes: ['id', 'name'] };
const ALL_INCLUDES = [creatorInclude, assigneeInclude, deptInclude, projectInclude];

function toRecord(row: Model): TmsTaskRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    project_name: (plain.project as { name?: string } | null)?.name ?? '',
    assignee_name: (plain.assignee as { name?: string } | null)?.name ?? '',
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
    updated_at: isoOrEmpty(plain.updatedAt)
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'number') record[name] = raw === null || raw === undefined ? 0 : Number(raw);
    else if (kind === 'json') record[name] = raw ?? [];
    else record[name] = raw ?? '';
  }
  return record as unknown as TmsTaskRecord;
}

async function readAll(): Promise<TmsTaskRecord[]> {
  const rows = await db.TmsTask.findAll({ include: ALL_INCLUDES, order: [['due_date', 'ASC']] });
  return rows.map(toRecord);
}

// Row-level visibility: the one deliberate restriction in TMS — Engineer/
// Technician (no `manage` on tms-tasks) see only tasks assigned to or
// created by them; Team Lead/Technical Manager/privileged viewers see every
// task. See lib/tmsAccess.ts's canManageAllTmsTasks and the TMS plan §3.5.
async function list(viewer: TmsViewer): Promise<TmsTaskRecord[]> {
  if (await canManageAllTmsTasks(viewer)) return readAll();

  const ownId = viewer.userId || '00000000-0000-0000-0000-000000000000';
  const rows = await db.TmsTask.findAll({
    where: { [Op.or]: [{ assignee_id: ownId }, { created_by: ownId }] } as never,
    include: ALL_INCLUDES,
    order: [['due_date', 'ASC']]
  });
  return rows.map(toRecord);
}

// For an arbitrary target person (not the calling viewer) — e.g. the Person
// Performance Dashboard drill-down, where the caller has already authorized
// itself to view that person's data via resolveVisibilityScope. Unlike
// list(viewer), this deliberately does not also match created_by: a task
// someone merely created for someone else isn't "their" task the way an
// assignment is.
async function listForAssignee(userId: string): Promise<TmsTaskRecord[]> {
  if (!isUuid(userId)) return [];
  const rows = await db.TmsTask.findAll({ where: { assignee_id: userId } as never, include: ALL_INCLUDES, order: [['due_date', 'ASC']] });
  return rows.map(toRecord);
}

async function findById(id: string): Promise<TmsTaskRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.TmsTask.findByPk(id, { include: ALL_INCLUDES });
  return row ? toRecord(row) : undefined;
}

async function create(record: TmsTaskRecord): Promise<TmsTaskRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  const row = await db.TmsTask.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never);
  const withAssoc = await db.TmsTask.findByPk(row.get('id') as string, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

async function update(id: string, patch: Partial<TmsTaskRecord>): Promise<TmsTaskRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsTask.findByPk(id);
  if (!row) return null;

  const attrs: Record<string, unknown> = {};
  const patchObj = patch as unknown as Record<string, unknown>;
  for (const { name, kind = 'string' } of FIELDS) {
    if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
  }

  // Auto-set/clear completion_date on transitions into/out of 'completed' —
  // "when" the task was completed, not "how long it took" (no duration/hours
  // are ever derived from this — see the module's no-time-tracking rule).
  if (typeof patch.status === 'string' && !('completion_date' in patchObj)) {
    const current = row.get({ plain: true }) as Record<string, unknown>;
    if (patch.status === 'completed' && current.status !== 'completed') {
      attrs.completion_date = new Date().toISOString().slice(0, 10);
    } else if (patch.status !== 'completed' && current.status === 'completed') {
      attrs.completion_date = null;
    }
  }

  await row.update(attrs as never);
  const withAssoc = await db.TmsTask.findByPk(id, { include: ALL_INCLUDES });
  return toRecord(withAssoc as Model);
}

async function remove(id: string, viewerIsPrivilegedOrManages: boolean): Promise<boolean> {
  if (!viewerIsPrivilegedOrManages) return false;
  if (!isUuid(id)) return false;
  const row = await db.TmsTask.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

// Shared by both app/api/tms/tasks/[id]/route.ts (manager PATCH) and
// app/api/tms/tasks/[id]/update/route.ts (engineer action) — a task's own
// record has no owner/department scope check beyond the module gate; this is
// the one shared re-derivation of "own or can-manage-all".
export async function canAccessTask(viewer: TmsViewer, task: { assignee_id: string; created_by: string }): Promise<boolean> {
  if (await canManageAllTmsTasks(viewer)) return true;
  // created_by is a resolved username (see toRecord above); assignee_id
  // stays the raw FK, hence comparing against viewer.userId, not viewer.username.
  return task.created_by === viewer.username || task.assignee_id === viewer.userId;
}

const ACTION_STATUS: Record<EngineerTaskAction, TmsTaskStatus> = {
  start: 'in_progress',
  progress: 'in_progress',
  blocked: 'blocked',
  ready_for_review: 'ready_for_review',
  reopen: 'in_progress'
};

// Valid FROM -> TO transitions for a non-manager-tier actor (engineer/
// technician working their own task) — manager-tier/privileged callers
// bypass this entirely via the existing generic PATCH route, which keeps
// today's unrestricted behavior unchanged. 'progress' doesn't change status
// at all (just logs a progress update while staying in_progress).
const VALID_TRANSITIONS: Record<TmsTaskStatus, EngineerTaskAction[]> = {
  to_do: ['start'],
  in_progress: ['progress', 'blocked', 'ready_for_review'],
  blocked: ['reopen'],
  ready_for_review: [],
  on_hold: [],
  completed: [],
  cancelled: []
};

export function isValidEngineerTransition(currentStatus: TmsTaskStatus, action: EngineerTaskAction): boolean {
  return (VALID_TRANSITIONS[currentStatus] || []).includes(action);
}

// The generic PATCH route (app/api/tms/tasks/[id]/route.ts) is reachable by
// a task's own assignee too (canAccessTask grants edit to assignee/creator,
// not just manager-tier) — so a raw `{status: 'completed'}` PATCH would
// otherwise let an engineer bypass every transition rule above entirely.
// This re-derives the same allowed FROM->TO edges directly from
// VALID_TRANSITIONS (via each action's resulting status) for that route to
// gate non-manager-tier status changes with, without duplicating the map.
export function isValidNonManagerStatusChange(from: TmsTaskStatus, to: TmsTaskStatus): boolean {
  if (from === to) return true;
  return (VALID_TRANSITIONS[from] || []).some((action) => ACTION_STATUS[action] === to);
}

export function statusForEngineerAction(action: EngineerTaskAction): TmsTaskStatus {
  return ACTION_STATUS[action];
}

function toUpdateRecord(row: Model): TmsTaskUpdateRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const updatedBy = plain.updatedBy as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    taskId: plain.task_id as string,
    progressPercent: Number(plain.progress_percent) || 0,
    statusAtUpdate: plain.status_at_update as TmsTaskStatus,
    remark: (plain.remark as string) ?? '',
    attachments: Array.isArray(plain.attachments) ? (plain.attachments as string[]) : [],
    updatedByName: updatedBy?.name ?? updatedBy?.username ?? '',
    updatedByUsername: updatedBy?.username ?? '',
    createdAt: isoOrEmpty(plain.created_at)
  };
}

export async function listTaskUpdates(taskId: string): Promise<TmsTaskUpdateRecord[]> {
  if (!isUuid(taskId)) return [];
  const rows = await db.TmsTaskUpdate.findAll({
    where: { task_id: taskId } as never,
    include: [{ model: db.User, as: 'updatedBy', attributes: ['id', 'username', 'name'] }],
    order: [['created_at', 'DESC']]
  });
  return rows.map(toUpdateRecord);
}

export interface RecordTaskUpdateInput {
  taskId: string;
  status: TmsTaskStatus;
  progressPercent?: number;
  remark: string;
  updatedByUserId: string;
}

// Inserts the immutable update-history row and patches the task's live
// status/progress together — this, not the generic update() above, is what
// app/api/tms/tasks/[id]/update/route.ts calls, so every engineer action
// always leaves a trail.
export async function recordTaskUpdate(input: RecordTaskUpdateInput): Promise<TmsTaskRecord | null> {
  const clampedProgress = input.progressPercent === undefined ? undefined : Math.max(0, Math.min(100, input.progressPercent));
  await db.TmsTaskUpdate.create({
    task_id: input.taskId,
    progress_percent: clampedProgress ?? 0,
    status_at_update: input.status,
    remark: input.remark || '',
    updated_by: input.updatedByUserId
  } as never);

  const patch: Record<string, unknown> = { status: input.status };
  if (clampedProgress !== undefined) patch.progress_percent = clampedProgress;
  return update(input.taskId, patch as Partial<TmsTaskRecord>);
}

export interface RecentTaskUpdate extends TmsTaskUpdateRecord {
  taskName: string;
}

// For the Person Dashboard's "recent activity" — joins across every task
// this person is assigned to, not just one task's own history (that's
// listTaskUpdates above).
export async function listRecentTaskUpdatesForAssignee(userId: string, limit = 10): Promise<RecentTaskUpdate[]> {
  if (!isUuid(userId)) return [];
  const rows = await db.TmsTaskUpdate.findAll({
    include: [
      { model: db.User, as: 'updatedBy', attributes: ['id', 'username', 'name'] },
      { model: db.TmsTask, as: 'task', attributes: ['id', 'name'], where: { assignee_id: userId } as never, required: true }
    ],
    order: [['created_at', 'DESC']],
    limit
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const task = plain.task as { name?: string } | null;
    return { ...toUpdateRecord(row), taskName: task?.name ?? '' };
  });
}

export const tmsTaskStore = { list, readAll, listForAssignee, findById, create, update, remove };
