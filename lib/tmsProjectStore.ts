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
  { name: 'project_manager_id', kind: 'nullable' as const },
  { name: 'team_member_ids', kind: 'json' as const },
  { name: 'start_date', kind: 'nullable' as const },
  { name: 'estimated_close_date', kind: 'nullable' as const },
  { name: 'actual_close_date', kind: 'nullable' as const },
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
const ALL_INCLUDES = [creatorInclude, managerInclude, deptInclude];

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
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
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
// every department; technical-manager/team-lead see their own department's
// projects only; engineer/technician see only projects they created, manage,
// or are a team member on.
async function list(viewer: TmsViewer): Promise<TmsProjectRecord[]> {
  if (viewer.isPrivileged) {
    const rows = await db.TmsProject.findAll({ include: ALL_INCLUDES, order: [['created_at', 'DESC']] });
    return toRecords(rows);
  }

  if (isTmsManagerTier(viewer)) {
    if (!viewer.departmentId) return [];
    const rows = await db.TmsProject.findAll({
      where: { department_id: viewer.departmentId } as never,
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

async function findById(id: string): Promise<TmsProjectRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.TmsProject.findByPk(id, { include: ALL_INCLUDES });
  return row ? (await toRecords([row]))[0] : undefined;
}

async function create(record: TmsProjectRecord): Promise<TmsProjectRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  const row = await db.TmsProject.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never);
  const withAssoc = await db.TmsProject.findByPk(row.get('id') as string, { include: ALL_INCLUDES });
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
  await row.update(attrs as never);
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
