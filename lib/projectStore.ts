import { Model, Op } from 'sequelize';
import { ProjectNote, ProjectRecord, ProjectStage, ProjectTimelineEvent } from './types';
import { db, isUuid, sequelize } from './db';
import { resolveVisibilityScope } from './departmentScope';

const FIELDS = [
  { name: 'client_name' },
  { name: 'company' },
  { name: 'contact_person' },
  { name: 'alt_contact_phone' },
  { name: 'phone' },
  { name: 'email' },
  { name: 'address' },
  { name: 'sales_person' },
  { name: 'source' },
  { name: 'status' },
  { name: 'stage' },
  { name: 'cold_call_responded' },
  { name: 'priority' },
  { name: 'expected_closing_date', kind: 'nullable' as const },
  { name: 'next_follow_up_date', kind: 'nullable' as const },
  { name: 'remarks' },
  { name: 'attachments', kind: 'json' as const },
  { name: 'assigned_technical_person_id', kind: 'nullable' as const },
  { name: 'tms_project_id', kind: 'nullable' as const }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable') return value === '' || value === undefined ? null : value;
  return value;
}

function noteToRow(note: ProjectNote, projectId: string) {
  return { project_id: projectId, at: note.at ? new Date(note.at) : new Date(), by: note.by, text: note.text };
}

// Note: takes an already-plain object, not a Model — these come from a
// parent row's `.get({ plain: true })`, which recursively flattens included
// associations into plain objects too (they're never Model instances here).
function rowToNote(plain: Record<string, unknown>): ProjectNote {
  return { id: plain.id as string, at: isoOrEmpty(plain.at), by: (plain.by as string) ?? '', text: (plain.text as string) ?? '' };
}

function timelineToRow(event: ProjectTimelineEvent, projectId: string) {
  return { project_id: projectId, at: event.at ? new Date(event.at) : new Date(), by: event.by, stage: event.stage, label: event.label, remarks: event.remarks };
}

function rowToTimelineEvent(plain: Record<string, unknown>): ProjectTimelineEvent {
  return {
    id: plain.id as string,
    at: isoOrEmpty(plain.at),
    by: (plain.by as string) ?? '',
    stage: plain.stage as ProjectTimelineEvent['stage'],
    label: (plain.label as string) ?? '',
    remarks: (plain.remarks as string) ?? ''
  };
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const assignedTechnicalPersonInclude = { model: db.User, as: 'assignedTechnicalPersonRef', attributes: ['id', 'name'] };
const notesInclude = { model: db.ProjectNote, as: 'notes' };
const timelineInclude = { model: db.ProjectTimelineEvent, as: 'timeline' };
const allIncludes = [creatorInclude, assignedTechnicalPersonInclude, notesInclude, timelineInclude];
// List views (Dashboard, Projects table, KPIs, search) only ever read the
// plain project fields — never .notes/.timeline, which for a project with a
// long history can be the bulk of the row's join cost. toRecord() already
// defaults both to [] when the include isn't present, so this is a drop-in
// lighter read for anything that isn't rendering a single project's full
// history (see findProjectById / performance-review, which still need them).
const lightIncludes = [creatorInclude, assignedTechnicalPersonInclude];

function toRecord(row: Model): ProjectRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    assigned_technical_person_name: (plain.assignedTechnicalPersonRef as { name?: string } | null)?.name ?? '',
    notes: ((plain.notes as Record<string, unknown>[]) ?? []).map(rowToNote).sort((a, b) => (a.at < b.at ? -1 : 1)),
    timeline: ((plain.timeline as Record<string, unknown>[]) ?? []).map(rowToTimelineEvent).sort((a, b) => (a.at < b.at ? -1 : 1))
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'json') record[name] = raw ?? [];
    else record[name] = raw ?? '';
  }
  return record as unknown as ProjectRecord;
}

async function readAll(): Promise<ProjectRecord[]> {
  const rows = await db.Project.findAll({ include: allIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function readAllLight(): Promise<ProjectRecord[]> {
  const rows = await db.Project.findAll({ include: lightIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

// Visibility (not capability — remove()/delete rights below still key off
// viewerIsPrivileged as before) is resolved from the viewer's department
// scope, not the raw isPrivileged flag: an org-wide viewer gets {} (no
// filter), everyone else sees projects they created OR are the assigned
// technical person on, widened to their whole managed department's team
// when they manage one. See lib/departmentScope.ts.
//
// The 'engineer' role is the one exception to "created OR assigned": they
// can't create Sales projects at all (see app/api/projects/route.ts's POST
// guard), so the created_by branch would only ever resurface stale/legacy
// rows, not anything they're meant to be working from — they only ever see
// what they're actually assigned to.
async function resolveOwnerWhere(viewerUsername: string): Promise<Record<string, unknown>> {
  const scope = await resolveVisibilityScope(viewerUsername);
  if (!scope.scopedUserIds) return {};

  const viewer = await db.User.findOne({
    where: { username: viewerUsername } as never,
    include: [{ model: db.Role, as: 'role', attributes: ['key'] }]
  });
  const roleKey = (viewer?.get({ plain: true }) as { role?: { key?: string } } | undefined)?.role?.key;
  if (roleKey === 'engineer') {
    return { assigned_technical_person_id: { [Op.in]: scope.scopedUserIds } };
  }

  return { [Op.or]: [{ created_by: { [Op.in]: scope.scopedUserIds } }, { assigned_technical_person_id: { [Op.in]: scope.scopedUserIds } }] };
}

async function list(viewerUsername: string): Promise<ProjectRecord[]> {
  const where = await resolveOwnerWhere(viewerUsername);
  const rows = await db.Project.findAll({ where: where as never, include: allIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function listLight(viewerUsername: string): Promise<ProjectRecord[]> {
  const where = await resolveOwnerWhere(viewerUsername);
  const rows = await db.Project.findAll({ where: where as never, include: lightIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

// Strictly "projects this one user personally created" — used by admin
// per-employee reports (Activity, Performance Review), which must not
// silently widen to a target's whole managed team just because they happen
// to be a department manager (unlike list()/listLight() above, which
// resolve the VIEWER's own visibility scope for dashboards/list pages).
async function listOwnedBy(username: string): Promise<ProjectRecord[]> {
  const user = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
  const where = { created_by: user ? user.get('id') : '00000000-0000-0000-0000-000000000000' };
  const rows = await db.Project.findAll({ where: where as never, include: lightIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function create(record: ProjectRecord): Promise<ProjectRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  // created_by is "the sales person" (see comment below), which is usually
  // but not guaranteed to be a real logged-in account — falls back to NULL
  // (viewer-privileged-only visibility) rather than failing the write.
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  return sequelize.transaction(async (t) => {
    const row = await db.Project.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never, { transaction: t });
    if (record.notes?.length) await db.ProjectNote.bulkCreate(record.notes.map((n) => noteToRow(n, row.get('id') as string)) as never, { transaction: t });
    if (record.timeline?.length) await db.ProjectTimelineEvent.bulkCreate(record.timeline.map((e) => timelineToRow(e, row.get('id') as string)) as never, { transaction: t });
    const withAssoc = await db.Project.findByPk(row.get('id') as string, { include: allIncludes, transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function update(id: string, patch: Partial<ProjectRecord>): Promise<ProjectRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Project.findByPk(id);
  if (!row) return null;

  return sequelize.transaction(async (t) => {
    const attrs: Record<string, unknown> = {};
    const patchObj = patch as unknown as Record<string, unknown>;
    for (const { name, kind = 'string' } of FIELDS) {
      if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
    }
    await row.update(attrs as never, { transaction: t });

    if (patch.notes) {
      await db.ProjectNote.destroy({ where: { project_id: id } as never, transaction: t });
      if (patch.notes.length) await db.ProjectNote.bulkCreate(patch.notes.map((n) => noteToRow(n, id)) as never, { transaction: t });
    }
    if (patch.timeline) {
      await db.ProjectTimelineEvent.destroy({ where: { project_id: id } as never, transaction: t });
      if (patch.timeline.length) await db.ProjectTimelineEvent.bulkCreate(patch.timeline.map((e) => timelineToRow(e, id)) as never, { transaction: t });
    }

    const withAssoc = await db.Project.findByPk(id, { include: allIncludes, transaction: t });
    return toRecord(withAssoc as Model);
  });
}

// A project with any dependent record (site visit, quotation, demo,
// negotiation, PO, customer response, installation, DC) can't be deleted —
// deleting the project only soft-deletes it (paranoid: true), so nothing is
// physically lost, but every child record's project_id would silently point
// at a project that findProjectById can no longer resolve, with no way back
// to it from those lists. Same "in use -> block, not silently orphan"
// pattern as lib/departmentStore.ts's deleteDepartment.
async function isProjectInUse(id: string): Promise<boolean> {
  const [siteVisits, quotations, demos, negotiations, pos, responses, installations, dcs] = await Promise.all([
    db.SiteVisit.count({ where: { project_id: id } as never }),
    db.Quotation.count({ where: { project_id: id } as never }),
    db.DemoSchedule.count({ where: { project_id: id } as never }),
    db.Negotiation.count({ where: { project_id: id } as never }),
    db.PurchaseOrder.count({ where: { project_id: id } as never }),
    db.CustomerResponse.count({ where: { project_id: id } as never }),
    db.Installation.count({ where: { project_id: id } as never }),
    db.DeliveryChallan.count({ where: { project_id: id } as never })
  ]);
  return siteVisits + quotations + demos + negotiations + pos + responses + installations + dcs > 0;
}

async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (!viewerIsPrivileged) return { ok: false, reason: 'Project not found' };
  if (!isUuid(id)) return { ok: false, reason: 'Project not found' };
  const row = await db.Project.findByPk(id);
  if (!row) return { ok: false, reason: 'Project not found' };
  if (await isProjectInUse(id)) {
    return { ok: false, reason: 'This project has linked records (site visits, quotations, demos, etc.) and cannot be deleted — its status/stage can still be changed to reflect it is closed/lost.' };
  }
  await row.destroy();
  return { ok: true };
}

// Records written before `notes`/`attachments` existed on ProjectRecord won't
// have them in blob storage — every reader of a single project must go
// through this so the View page (and anything else touching `.notes`/
// `.attachments`) never crashes on `undefined.length`.
function normalizeProject(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    notes: project.notes ?? [],
    attachments: project.attachments ?? [],
    timeline: project.timeline ?? [],
    source: project.source ?? ''
  };
}

// list/listLight keep accepting viewerIsPrivileged for call-site
// compatibility (every route still has it handy from getViewerContext) but
// no longer use it directly — visibility is resolved from the viewer's
// department scope instead (see resolveOwnerWhere/resolveVisibilityScope).
// remove() below still keys deletion rights off viewerIsPrivileged, which is
// a capability check, not a visibility one, and stays exactly as it was.
export const projectStore = {
  list: async (viewerUsername: string, _viewerIsPrivileged: boolean) => (await list(viewerUsername)).map(normalizeProject),
  listLight: async (viewerUsername: string, _viewerIsPrivileged: boolean) => (await listLight(viewerUsername)).map(normalizeProject),
  listOwnedBy: async (username: string) => (await listOwnedBy(username)).map(normalizeProject),
  // Unscoped — every project, no visibility filtering. For aggregate/admin
  // computations only (e.g. department health scoring), never for a
  // viewer-facing list; callers must apply their own authorization first.
  readAll: async () => (await readAll()).map(normalizeProject),
  // Same as readAll() but without the notes/timeline joins — for aggregate
  // computations (department health scoring) that only ever read plain
  // fields, same rationale as listLight() above.
  readAllLight: async () => (await readAllLight()).map(normalizeProject),
  create,
  update,
  remove
};

export async function findProjectById(id: string): Promise<ProjectRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Project.findByPk(id, { include: allIncludes });
  return row ? normalizeProject(toRecord(row)) : undefined;
}

// Appends one timeline entry and, when `advanceStageTo` is given, moves the
// project's current stage/status forward. Called from every linked module's
// API route (site visit, quotation, demo, customer response, negotiation,
// PO, installation) whenever a record carries a project_id, so the Project
// Timeline stays complete without any manual step.
export async function appendProjectTimeline(
  projectId: string,
  event: { by: string; stage: ProjectStage | 'created'; label: string; remarks?: string },
  advanceStageTo?: ProjectStage
): Promise<ProjectRecord | null> {
  if (!projectId || !isUuid(projectId)) return null;
  const row = await db.Project.findByPk(projectId);
  if (!row) return null;

  return sequelize.transaction(async (t) => {
    await db.ProjectTimelineEvent.create(
      { project_id: projectId, at: new Date(), by: event.by, stage: event.stage, label: event.label, remarks: event.remarks || '' } as never,
      { transaction: t }
    );
    const current = row.get({ plain: true }) as Record<string, unknown>;
    await row.update(
      {
        stage: advanceStageTo || current.stage,
        status: advanceStageTo === 'completed' ? 'won' : advanceStageTo === 'closed_lost' ? 'lost' : current.status
      } as never,
      { transaction: t }
    );
    const withAssoc = await db.Project.findByPk(projectId, { include: allIncludes, transaction: t });
    return normalizeProject(toRecord(withAssoc as Model));
  });
}
