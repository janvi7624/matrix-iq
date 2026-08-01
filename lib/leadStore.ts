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

// Same mobile number or email address, whoever scanned it — the trade-show
// duplicate scenario the spec calls out (two reps scan the same card). Runs
// org-wide (not viewer-scoped): the whole point is catching a duplicate
// created by a DIFFERENT user, not just the current one's own leads.
function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findDuplicateLead(mobile: string, email: string): Promise<LeadRecord | undefined> {
  const normMobile = normalizeMobile(mobile);
  const normEmail = normalizeEmail(email);
  if (!normMobile && !normEmail) return undefined;

  const records = await readJsonBlob<LeadRecord[]>(DATA_PATHNAME, []);
  return records.find((l) => (normMobile && normalizeMobile(l.mobile) === normMobile) || (normEmail && normalizeEmail(l.email) === normEmail));
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
