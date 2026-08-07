import { LeadRecord } from './types';
import { createRecordStore } from './recordStore';
import { db, isUuid } from './db';
import { isLeadUnattended } from './followUp';

const LEAD_FIELDS = [
  { name: 'updated_at', kind: 'date' as const, column: 'updatedAt' },
  { name: 'name' },
  { name: 'mobile' },
  { name: 'email' },
  { name: 'designation' },
  { name: 'company' },
  { name: 'city' },
  { name: 'card_image_url' },
  { name: 'interests', kind: 'json' as const },
  { name: 'sub_interests', kind: 'json' as const },
  { name: 'priority', kind: 'nullable' as const },
  { name: 'follow_up_actions', kind: 'json' as const },
  { name: 'budget' },
  { name: 'notes' },
  { name: 'project_id', kind: 'nullable' as const }
];

const base = createRecordStore<LeadRecord>(db.Lead, LEAD_FIELDS);

export const leadStore = {
  list: base.list,
  create: base.create,
  update: base.update,
  remove: base.remove
};

export async function findLeadById(id: string): Promise<LeadRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Lead.findByPk(id, { include: [{ model: db.User, as: 'creator', attributes: ['id', 'username'] }] });
  return row ? base.toRecord(row) : undefined;
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

  const records = await base.readAll();
  return records.find((l) => (normMobile && normalizeMobile(l.mobile) === normMobile) || (normEmail && normalizeEmail(l.email) === normEmail));
}

export interface LeadStats {
  total: number;
  today: number;
  hot: number;
  unattended: number;
}

export async function computeLeadStats(viewerUsername: string, viewerIsPrivileged: boolean): Promise<LeadStats> {
  const leads = await base.list(viewerUsername, viewerIsPrivileged);
  const todayStr = new Date().toDateString();
  return {
    total: leads.length,
    today: leads.filter((l) => new Date(l.created_at).toDateString() === todayStr).length,
    hot: leads.filter((l) => l.priority === 'hot').length,
    unattended: leads.filter(isLeadUnattended).length
  };
}
