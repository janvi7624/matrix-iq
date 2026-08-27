import { DomainKey, LeadPriority, LeadRecord } from './types';
import { createRecordStore } from './recordStore';
import { db, isUuid } from './db';
import { isLeadUnattended } from './followUp';

function unionStrings(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

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

const base = createRecordStore<LeadRecord>(db.Lead, LEAD_FIELDS, { departmentScoped: true });

export const leadStore = {
  list: base.list,
  listOwnedBy: base.listOwnedBy,
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

// Runs on every single lead capture (the app's busiest write path — rapid
// trade-show scanning), so this only pulls the 3 columns actually needed to
// match, not the full row + creator join every other read does — matching
// still happens in JS (not a raw SQL regex) so the normalization logic here
// stays the single source of truth, easy to verify, and can't silently drift
// from what a SQL rewrite of the same rules would do.
export { normalizeMobile, normalizeEmail };

export async function findDuplicateLead(mobile: string, email: string): Promise<LeadRecord | undefined> {
  const normMobile = normalizeMobile(mobile);
  const normEmail = normalizeEmail(email);
  if (!normMobile && !normEmail) return undefined;

  const rows = await db.Lead.findAll({ attributes: ['id', 'mobile', 'email'] });
  const match = rows.find(
    (r) => (normMobile && normalizeMobile(r.get('mobile') as string) === normMobile) || (normEmail && normalizeEmail(r.get('email') as string) === normEmail)
  );
  return match ? findLeadById(match.get('id') as string) : undefined;
}

// Everything a caller can supply about a lead before it's known whether
// it'll become a new record or get merged into an existing one — used by
// both the single-capture POST route and bulk import, so there's exactly
// one implementation of "what happens when a duplicate is found."
export interface CreateOrMergeLeadInput {
  name: string;
  mobile: string;
  email: string;
  designation: string;
  company: string;
  city: string;
  cardImageUrl: string;
  interests: DomainKey[];
  subInterests: string[];
  followUpActions: string[];
  priority: LeadPriority;
  budget: string;
  notes: string;
}

export interface CreateOrMergeLeadResult {
  record: LeadRecord;
  merged: boolean;
  // The existing lead as it was BEFORE the merge — only set when merged is
  // true. Callers use this for audit logging (previous priority, who
  // originally captured it) since that information no longer exists once
  // the merge has happened.
  duplicateBefore?: LeadRecord;
}

export async function createOrMergeLead(input: CreateOrMergeLeadInput, actorUsername: string): Promise<CreateOrMergeLeadResult> {
  const now = new Date().toISOString();
  const duplicate = await findDuplicateLead(input.mobile, input.email);
  if (duplicate) {
    const merged = await base.update(duplicate.id, {
      name: input.name || duplicate.name,
      company: input.company || duplicate.company,
      mobile: input.mobile || duplicate.mobile,
      email: input.email || duplicate.email,
      designation: input.designation || duplicate.designation,
      city: input.city || duplicate.city,
      card_image_url: input.cardImageUrl || duplicate.card_image_url,
      interests: unionStrings(duplicate.interests, input.interests) as DomainKey[],
      sub_interests: unionStrings(duplicate.sub_interests, input.subInterests),
      follow_up_actions: unionStrings(duplicate.follow_up_actions, input.followUpActions),
      priority: input.priority || duplicate.priority,
      budget: input.budget || duplicate.budget,
      notes: input.notes ? (duplicate.notes ? `${duplicate.notes}\n---\n${input.notes}` : input.notes) : duplicate.notes,
      updated_at: now
    });
    return { record: (merged as LeadRecord) ?? duplicate, merged: true, duplicateBefore: duplicate };
  }

  const record: LeadRecord = {
    id: `${Date.now()}`,
    created_at: now,
    created_by: actorUsername,
    updated_at: now,
    name: input.name,
    mobile: input.mobile,
    email: input.email,
    designation: input.designation,
    company: input.company,
    city: input.city,
    card_image_url: input.cardImageUrl,
    interests: input.interests,
    sub_interests: input.subInterests,
    priority: input.priority,
    follow_up_actions: input.followUpActions,
    budget: input.budget,
    notes: input.notes,
    project_id: ''
  };
  const created = await base.create(record);
  return { record: created, merged: false };
}

// One row from either a mapped CSV or an OCR'd business-card image — the
// two bulk-import entry points converge on this exact shape so the rest of
// the pipeline (preview, commit, dedup) doesn't need to know which one a
// row came from.
export interface BulkLeadRow {
  name: string;
  mobile: string;
  email: string;
  designation: string;
  company: string;
  city: string;
  cardImageUrl: string;
  budget: string;
  notes: string;
}

export type BulkLeadRowStatus = 'valid' | 'duplicate' | 'invalid';

export interface BulkLeadPreviewResult {
  index: number;
  row: BulkLeadRow;
  status: BulkLeadRowStatus;
  reason?: string;
  existingLead?: { id: string; name: string; company: string; mobile: string; email: string; created_by: string };
}

// Classifies every row without writing anything — checks both the DB (via
// findDuplicateLead, same rule single-capture already uses) and an
// in-memory index of normalized mobile/email seen earlier in THIS batch
// (findDuplicateLead alone only ever sees what's already committed, so two
// rows for the same person in one CSV/image batch would otherwise both
// come back "valid" and create two leads — mirrors the in-batch dedup
// lib/userImportStore.ts's processEmployeeImport already does for bulk
// employee import).
export async function previewBulkLeads(rows: BulkLeadRow[]): Promise<BulkLeadPreviewResult[]> {
  const results: BulkLeadPreviewResult[] = [];
  const seenMobile = new Map<string, number>();
  const seenEmail = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.name?.trim() || '';
    const company = row.company?.trim() || '';
    if (!name && !company) {
      results.push({ index: i, row, status: 'invalid', reason: 'Name or company is required' });
      continue;
    }

    const normMobile = normalizeMobile(row.mobile || '');
    const normEmail = normalizeEmail(row.email || '');

    if (normMobile && seenMobile.has(normMobile)) {
      results.push({ index: i, row, status: 'duplicate', reason: `Same phone as row ${seenMobile.get(normMobile)! + 1} earlier in this file` });
      continue;
    }
    if (normEmail && seenEmail.has(normEmail)) {
      results.push({ index: i, row, status: 'duplicate', reason: `Same email as row ${seenEmail.get(normEmail)! + 1} earlier in this file` });
      continue;
    }

    const existing = await findDuplicateLead(row.mobile || '', row.email || '');
    if (existing) {
      results.push({
        index: i,
        row,
        status: 'duplicate',
        reason: `Already captured by ${existing.created_by}`,
        existingLead: { id: existing.id, name: existing.name, company: existing.company, mobile: existing.mobile, email: existing.email, created_by: existing.created_by }
      });
    } else {
      results.push({ index: i, row, status: 'valid' });
    }

    if (normMobile) seenMobile.set(normMobile, i);
    if (normEmail) seenEmail.set(normEmail, i);
  }

  return results;
}

export interface BulkLeadCommitRowResult {
  index: number;
  status: 'created' | 'merged' | 'failed';
  reason?: string;
  leadId?: string;
}

export interface BulkLeadCommitSummary {
  created: number;
  merged: number;
  failed: number;
  results: BulkLeadCommitRowResult[];
}

// Re-runs preview at commit time too (not just trusting the client's earlier
// preview call) — a concurrent import between preview and commit shouldn't
// be able to create a real duplicate. "Duplicate" rows are merged, not
// skipped, matching single-capture's existing behavior — the caller
// controls which rows actually reach commit by only sending the ones the
// user approved on the review screen.
export async function commitBulkLeads(rows: BulkLeadRow[], actorUsername: string): Promise<BulkLeadCommitSummary> {
  const preview = await previewBulkLeads(rows);
  const results: BulkLeadCommitRowResult[] = [];
  let created = 0;
  let merged = 0;
  let failed = 0;

  for (const p of preview) {
    if (p.status === 'invalid') {
      failed++;
      results.push({ index: p.index, status: 'failed', reason: p.reason });
      continue;
    }
    const row = p.row;
    const result = await createOrMergeLead(
      {
        name: row.name,
        mobile: row.mobile,
        email: row.email,
        designation: row.designation,
        company: row.company,
        city: row.city,
        cardImageUrl: row.cardImageUrl,
        interests: [],
        subInterests: [],
        followUpActions: [],
        priority: '',
        budget: row.budget,
        notes: row.notes
      },
      actorUsername
    );
    if (result.merged) {
      merged++;
      results.push({ index: p.index, status: 'merged', leadId: result.record.id });
    } else {
      created++;
      results.push({ index: p.index, status: 'created', leadId: result.record.id });
    }
  }

  return { created, merged, failed, results };
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
