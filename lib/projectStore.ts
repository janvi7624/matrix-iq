import { Model } from 'sequelize';
import { ProjectNote, ProjectRecord, ProjectStage, ProjectTimelineEvent } from './types';
import { db, isUuid, sequelize } from './db';

const FIELDS = [
  { name: 'client_name' },
  { name: 'company' },
  { name: 'contact_person' },
  { name: 'phone' },
  { name: 'email' },
  { name: 'address' },
  { name: 'sales_person' },
  { name: 'source' },
  { name: 'status' },
  { name: 'stage' },
  { name: 'priority' },
  { name: 'expected_closing_date', kind: 'nullable' as const },
  { name: 'next_follow_up_date', kind: 'nullable' as const },
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
const notesInclude = { model: db.ProjectNote, as: 'notes' };
const timelineInclude = { model: db.ProjectTimelineEvent, as: 'timeline' };

function toRecord(row: Model): ProjectRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
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
  const rows = await db.Project.findAll({ include: [creatorInclude, notesInclude, timelineInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<ProjectRecord[]> {
  const where: Record<string, unknown> = {};
  if (!viewerIsPrivileged) {
    const user = await db.User.findOne({ where: { username: viewerUsername } as never });
    where.created_by = user ? user.get('id') : '00000000-0000-0000-0000-000000000000';
  }
  const rows = await db.Project.findAll({ where: where as never, include: [creatorInclude, notesInclude, timelineInclude], order: [['created_at', 'DESC']] });
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
    const withAssoc = await db.Project.findByPk(row.get('id') as string, { include: [creatorInclude, notesInclude, timelineInclude], transaction: t });
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

    const withAssoc = await db.Project.findByPk(id, { include: [creatorInclude, notesInclude, timelineInclude], transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<boolean> {
  if (!viewerIsPrivileged) return false;
  if (!isUuid(id)) return false;
  const row = await db.Project.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
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

// Ownership for list/remove is keyed off `created_by`, same as every other
// record store — Project.created_by is always set to the sales person, so a
// plain "user"/"technical" account only sees their own projects.
export const projectStore = {
  list: async (viewerUsername: string, viewerIsPrivileged: boolean) => (await list(viewerUsername, viewerIsPrivileged)).map(normalizeProject),
  create,
  update,
  remove
};

export async function findProjectById(id: string): Promise<ProjectRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Project.findByPk(id, { include: [creatorInclude, notesInclude, timelineInclude] });
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
    const withAssoc = await db.Project.findByPk(projectId, { include: [creatorInclude, notesInclude, timelineInclude], transaction: t });
    return normalizeProject(toRecord(withAssoc as Model));
  });
}
