import { ProjectRecord, ProjectStage, ProjectTimelineEvent } from './types';
import { createRecordStore } from './recordStore';
import { readJsonBlob, writeJsonBlob } from './blobStore';

const DATA_PATHNAME = 'data/projects.json';
const base = createRecordStore<ProjectRecord>(DATA_PATHNAME);

// Ownership for list/remove is keyed off `created_by`, same as every other
// record store — Project.created_by is always set to the sales person, so a
// plain "user"/"technical" account only sees their own projects.
export const projectStore = {
  list: async (viewerUsername: string, viewerIsPrivileged: boolean) => (await base.list(viewerUsername, viewerIsPrivileged)).map(normalizeProject),
  create: base.create,
  update: base.update,
  remove: base.remove
};

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

async function readAll(): Promise<ProjectRecord[]> {
  return readJsonBlob<ProjectRecord[]>(DATA_PATHNAME, []);
}

async function writeAll(records: ProjectRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export async function findProjectById(id: string): Promise<ProjectRecord | undefined> {
  const records = await readAll();
  const project = records.find((p) => p.id === id);
  return project ? normalizeProject(project) : undefined;
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
  if (!projectId) return null;
  const records = await readAll();
  const index = records.findIndex((p) => p.id === projectId);
  if (index === -1) return null;

  const entry: ProjectTimelineEvent = {
    id: `${Date.now()}`,
    at: new Date().toISOString(),
    by: event.by,
    stage: event.stage,
    label: event.label,
    remarks: event.remarks || ''
  };

  const existing = records[index];
  const updated: ProjectRecord = {
    ...existing,
    timeline: [...existing.timeline, entry],
    stage: advanceStageTo || existing.stage,
    status: advanceStageTo === 'completed' ? 'won' : advanceStageTo === 'closed_lost' ? 'lost' : existing.status,
    updated_at: new Date().toISOString()
  };
  records[index] = updated;
  await writeAll(records);
  return updated;
}
