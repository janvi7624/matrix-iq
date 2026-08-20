import { Model, Op } from 'sequelize';
import { TmsTaskRecord } from './types';
import { db, isUuid } from './db';
import { canManageAllTmsTasks, TmsViewer } from './tmsAccess';

const FIELDS = [
  { name: 'project_id' },
  { name: 'name' },
  { name: 'assignee_id', kind: 'nullable' as const },
  { name: 'department_id', kind: 'nullable' as const },
  { name: 'description' },
  { name: 'priority' },
  { name: 'status' },
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

export const tmsTaskStore = { list, readAll, findById, create, update, remove };
