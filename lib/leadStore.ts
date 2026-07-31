import { LeadRecord } from './types';
import { createRecordStore } from './recordStore';
import { readJsonBlob } from './blobStore';

const DATA_PATHNAME = 'data/leads.json';
const base = createRecordStore<LeadRecord>(DATA_PATHNAME);

export const leadStore = {
  list: base.list,
  create: base.create,
  update: base.update,
  remove: base.remove
};

export async function findLeadById(id: string): Promise<LeadRecord | undefined> {
  const records = await readJsonBlob<LeadRecord[]>(DATA_PATHNAME, []);
  return records.find((l) => l.id === id);
}

export interface LeadStats {
  total: number;
  today: number;
  hot: number;
}

export async function computeLeadStats(viewerUsername: string, viewerIsPrivileged: boolean): Promise<LeadStats> {
  const leads = await base.list(viewerUsername, viewerIsPrivileged);
  const todayStr = new Date().toDateString();
  return {
    total: leads.length,
    today: leads.filter((l) => new Date(l.created_at).toDateString() === todayStr).length,
    hot: leads.filter((l) => l.priority === 'hot').length
  };
}
