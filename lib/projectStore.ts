import { ProjectRecord, ProjectStage, ProjectTimelineEvent } from './types';
import { createRecordStore } from './recordStore';
import { readJsonBlob, writeJsonBlob } from './blobStore';

const DATA_PATHNAME = 'data/projects.json';
const base = createRecordStore<ProjectRecord>(DATA_PATHNAME);

// Ownership for list/remove is keyed off `created_by`, same as every other
// record store — Project.created_by is always set to the sales person, so a
// plain "user"/"technical" account only sees their own projects.
export const projectStore = {
  list: base.list,
  create: base.create,
  update: base.update,
  remove: base.remove
};

async function readAll(): Promise<ProjectRecord[]> {
  return readJsonBlob<ProjectRecord[]>(DATA_PATHNAME, []);
}

async function writeAll(records: ProjectRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export async function findProjectById(id: string): Promise<ProjectRecord | undefined> {
  const records = await readAll();
  return records.find((p) => p.id === id);
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
