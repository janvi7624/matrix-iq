import { Model, Op } from 'sequelize';
import { TmsProjectRecord } from './types';
import { db, isUuid } from './db';
import { isTmsManagerTier, TmsViewer } from './tmsAccess';

const FIELDS = [
  { name: 'project_code' },
  { name: 'name' },
  { name: 'client_name' },
  { name: 'client_contact' },
  { name: 'description' },
  { name: 'department_id', kind: 'nullable' as const },
  { name: 'project_type' },
  { name: 'project_manager_id', kind: 'nullable' as const },
  { name: 'team_member_ids', kind: 'json' as const },
  { name: 'start_date', kind: 'nullable' as const },
  { name: 'estimated_close_date', kind: 'nullable' as const },
  { name: 'actual_close_date', kind: 'nullable' as const },
  { name: 'deadline', kind: 'nullable' as const },
  { name: 'budget', kind: 'number' as const },
  { name: 'status' },
  { name: 'priority' },
  { name: 'progress_percent', kind: 'number' as const },
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
const managerInclude = { model: db.User, as: 'projectManager', attributes: ['id', 'name'] };
const deptInclude = { model: db.Department, as: 'department', attributes: ['id', 'name'] };
const departmentsInclude = { model: db.Department, as: 'departments', attributes: ['id', 'name'], through: { attributes: [] } };
const ALL_INCLUDES = [creatorInclude, managerInclude, deptInclude, departmentsInclude];

// team_member_ids is a plain JSONB array of user ids (see db/models/tmsProject.js's
// comment) — not a Sequelize association, so resolving display names is a
// separate batch lookup, same "gather every id referenced across rows, one
// query, map back" approach as lib/departmentStore.ts's resolveManagerNames.
async function resolveTeamNames(rows: Model[]): Promise<Map<string, string>> {
  const allIds = new Set<string>();
  rows.forEach((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    (Array.isArray(plain.team_member_ids) ? (plain.team_member_ids as string[]) : []).forEach((id) => allIds.add(id));
  });
  if (!allIds.size) return new Map();
  const users = await db.User.findAll({ where: { id: [...allIds] } as never, attributes: ['id', 'name'] });
  return new Map(users.map((u) => [u.get('id') as string, u.get('name') as string]));
}

function toRecord(row: Model, teamNameMap: Map<string, string>): TmsProjectRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const teamIds = Array.isArray(plain.team_member_ids) ? (plain.team_member_ids as string[]) : [];
  const departments = Array.isArray(plain.departments) ? (plain.departments as { id: string; name: string }[]) : [];
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
    department_ids: departments.map((d) => d.id),
    department_names: departments.map((d) => d.name),
    project_manager_name: (plain.projectManager as { name?: string } | null)?.name ?? '',
    team_member_names: teamIds.map((id) => teamNameMap.get(id)).filter((n): n is string => !!n),
    updated_at: isoOrEmpty(plain.updatedAt)
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'number') record[name] = raw === null || raw === undefined ? 0 : Number(raw);
    else if (kind === 'json') record[name] = raw ?? (name === 'team_member_ids' ? [] : []);
    else record[name] = raw ?? '';
  }
  return record as unknown as TmsProjectRecord;
}

async function toRecords(rows: Model[]): Promise<TmsProjectRecord[]> {
  const teamNameMap = await resolveTeamNames(rows);
  return rows.map((row) => toRecord(row, teamNameMap));
}

// Row-level visibility, 3 tiers: superadmin/admin see every project across
// every department; technical-manager/team-lead see every project touching
// their own department (via tms_project_departments — a combined project is
// visible to EVERY member department's manager, not just its primary one);
// engineer/technician see only projects they created, manage, or are a team
// member on (department-agnostic, unaffected by combined projects).
async function list(viewer: TmsViewer): Promise<TmsProjectRecord[]> {
  if (viewer.isPrivileged) {
    const rows = await db.TmsProject.findAll({ include: ALL_INCLUDES, order: [['created_at', 'DESC']] });
    return toRecords(rows);
  }

  if (isTmsManagerTier(viewer)) {
    if (!viewer.departmentId) return [];
    const memberships = await db.TmsProjectDepartment.findAll({ where: { department_id: viewer.departmentId } as never, attributes: ['tms_project_id'] });
    const projectIds = memberships.map((m) => m.get('tms_project_id') as string);
    if (!projectIds.length) return [];
    const rows = await db.TmsProject.findAll({
      where: { id: projectIds } as never,
      include: ALL_INCLUDES,
      order: [['created_at', 'DESC']]
    });
    return toRecords(rows);
  }

  const ownId = viewer.userId || '00000000-0000-0000-0000-000000000000';
  const rows = await db.TmsProject.findAll({
    where: {
      [Op.or]: [{ project_manager_id: ownId }, { created_by: ownId }, { team_member_ids: { [Op.contains]: [ownId] } }]
    } as never,
    include: ALL_INCLUDES,
    order: [['created_at', 'DESC']]
  });
  return toRecords(rows);
}

// Row-level authorization for a single project, mirroring list()'s tiering —
// needed because the [id] routes (GET/PATCH/DELETE/extend-deadline) fetch a
// project directly by id, bypassing list()'s filtering entirely. Without
// this, requireTmsAction()'s module-level check alone ("is tms-projects
// visible to this role+department at all") lets any manager-tier viewer
// reach ANY project by id regardless of department — exactly the "Robotics
// Manager must not be able to manipulate an AV-only project" case the TMS
// access-control spec calls out explicitly.
export function canAccessTmsProjectRow(
  viewer: TmsViewer,
  project: Pick<TmsProjectRecord, 'department_id' | 'department_ids' | 'project_manager_id' | 'team_member_ids' | 'created_by'>
): boolean {
  if (viewer.isPrivileged) return true;
  if (isTmsManagerTier(viewer)) {
    const deptIds = project.department_ids.length ? project.department_ids : [project.department_id];
    return !!viewer.departmentId && deptIds.includes(viewer.departmentId);
  }
  const ownId = viewer.userId;
  return !!ownId && (project.project_manager_id === ownId || project.team_member_ids.includes(ownId) || project.created_by === viewer.username);
}

async function findById(id: string): Promise<TmsProjectRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.TmsProject.findByPk(id, { include: ALL_INCLUDES });
  return row ? (await toRecords([row]))[0] : undefined;
}

// Writes the tms_project_departments membership rows to match `departmentIds`
// exactly (replace, not merge) — called from both create() and update() so
// "which departments does this project touch" never drifts from what was
// last submitted.
async function syncDepartments(tmsProjectId: string, departmentIds: string[], transaction: unknown): Promise<void> {
  await db.TmsProjectDepartment.destroy({ where: { tms_project_id: tmsProjectId } as never, transaction: transaction as never });
  const unique = Array.from(new Set(departmentIds.filter(Boolean)));
  if (!unique.length) return;
  await db.TmsProjectDepartment.bulkCreate(
    unique.map((departmentId) => ({ tms_project_id: tmsProjectId, department_id: departmentId })) as never,
    { transaction: transaction as never }
  );
}

async function create(record: TmsProjectRecord): Promise<TmsProjectRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  const departmentIds = record.department_ids && record.department_ids.length ? record.department_ids : record.department_id ? [record.department_id] : [];

  const createdId = await db.sequelize.transaction(async (t) => {
    const row = await db.TmsProject.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never, { transaction: t });
    const id = row.get('id') as string;
    await syncDepartments(id, departmentIds, t);
    return id;
  });

  const withAssoc = await db.TmsProject.findByPk(createdId, { include: ALL_INCLUDES });
  return (await toRecords([withAssoc as Model]))[0];
}

async function update(id: string, patch: Partial<TmsProjectRecord>): Promise<TmsProjectRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsProject.findByPk(id);
  if (!row) return null;

  const attrs: Record<string, unknown> = {};
  const patchObj = patch as unknown as Record<string, unknown>;
  for (const { name, kind = 'string' } of FIELDS) {
    if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
  }

  await db.sequelize.transaction(async (t) => {
    await row.update(attrs as never, { transaction: t });
    if (patch.department_ids) await syncDepartments(id, patch.department_ids, t);
  });

  const withAssoc = await db.TmsProject.findByPk(id, { include: ALL_INCLUDES });
  return (await toRecords([withAssoc as Model]))[0];
}

// A project with any linked task/BOM request/procurement record can't be
// deleted — same "in use -> block, not silently orphan" pattern as
// lib/projectStore.ts's isProjectInUse / lib/departmentStore.ts's
// deleteDepartment.
async function isProjectInUse(id: string): Promise<boolean> {
  const [tasks, bomRequests, procurements] = await Promise.all([
    db.TmsTask.count({ where: { project_id: id } as never }),
    db.TmsBomRequest.count({ where: { project_id: id } as never }),
    db.TmsProcurement.count({ where: { project_id: id } as never })
  ]);
  return tasks + bomRequests + procurements > 0;
}

async function remove(id: string, viewerIsPrivilegedOrManages: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (!viewerIsPrivilegedOrManages) return { ok: false, reason: 'Project not found' };
  if (!isUuid(id)) return { ok: false, reason: 'Project not found' };
  const row = await db.TmsProject.findByPk(id);
  if (!row) return { ok: false, reason: 'Project not found' };
  if (await isProjectInUse(id)) {
    return { ok: false, reason: 'This project has linked tasks, BOM requests, or procurement records and cannot be deleted.' };
  }
  await row.destroy();
  return { ok: true };
}

// Live, derived-from-tasks progress — shown alongside (never overwriting)
// the manually-set progress_percent field, since some projects (e.g. one
// with no tasks yet) still rely on that manual figure. completed/total task
// count, not weighted by priority/size — simplest honest reading of "how
// much of the work is done".
export async function computeTaskDerivedProgress(tmsProjectId: string): Promise<number | null> {
  const tasks = await db.TmsTask.findAll({ where: { project_id: tmsProjectId } as never, attributes: ['status'] });
  if (!tasks.length) return null;
  const completed = tasks.filter((t) => t.get('status') === 'completed').length;
  return Math.round((completed / tasks.length) * 100);
}

export const tmsProjectStore = { list, findById, create, update, remove };

// TMS-PRJ-<seq> — same "read everything, find the max sequence, +1" approach
// as lib/deliveryChallanStore.ts's nextDcNumber().
export async function nextTmsProjectCode(): Promise<string> {
  const rows = await db.TmsProject.findAll({ attributes: ['project_code'], paranoid: false });
  const prefix = 'TMS-PRJ-';
  const pattern = /^TMS-PRJ-(\d+)$/;
  const max = rows.reduce((acc, r) => {
    const code = r.get('project_code') as string;
    const match = code ? code.match(pattern) : null;
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
