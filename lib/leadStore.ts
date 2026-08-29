import type { Model } from 'sequelize';
import { Op } from 'sequelize';
import { DomainKey, LeadPriority, LeadRecord } from './types';
import { createRecordStore } from './recordStore';
import { db, isUuid } from './db';
import { isLeadUnattended } from './followUp';
import { resolveVisibilityScope, canAccessOwnedRecord } from './departmentScope';

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
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'assigned_to_id', kind: 'nullable' as const },
  { name: 'assigned_by_id', kind: 'nullable' as const },
  { name: 'assigned_at', kind: 'date' as const }
];

const base = createRecordStore<LeadRecord>(db.Lead, LEAD_FIELDS, { departmentScoped: true });

// Leads read through their own include set rather than createRecordStore's
// creator-only one, because a lead now carries two more people: the assignee
// and whoever assigned them. createRecordStore is shared by six modules, so
// widening its include list there would make five unrelated modules pay for a
// join they don't use.
const LEAD_INCLUDES = () => [
  { model: db.User, as: 'creator', attributes: ['id', 'username'] },
  { model: db.User, as: 'assignee', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'assigner', attributes: ['id', 'username'] }
];

function toLeadRecord(row: Model): LeadRecord {
  const record = base.toRecord(row);
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const assignee = plain.assignee as { username?: string; name?: string } | null;
  const assigner = plain.assigner as { username?: string } | null;
  return {
    ...record,
    assigned_to: assignee?.username ?? '',
    assigned_to_name: assignee?.name || assignee?.username || '',
    assigned_by: assigner?.username ?? ''
  };
}

// Visibility is department scope OR assignment. The base store filters on
// created_by alone, which would mean a manager could assign a lead to a rep
// who then couldn't open it — the rep didn't capture it and may sit outside
// the capturer's department scope. Assignment has to grant access or the
// feature doesn't work.
async function listLeads(viewerUsername: string, _viewerIsPrivileged: boolean): Promise<LeadRecord[]> {
  const scope = await resolveVisibilityScope(viewerUsername);
  const where: Record<string | symbol, unknown> = {};
  if (scope.scopedUserIds) {
    where[Op.or] = [
      { created_by: { [Op.in]: scope.scopedUserIds } },
      { assigned_to_id: { [Op.in]: scope.scopedUserIds } }
    ];
  }
  const rows = await db.Lead.findAll({ where: where as never, include: LEAD_INCLUDES(), order: [['created_at', 'DESC']] });
  return rows.map(toLeadRecord);
}

export const leadStore = {
  list: listLeads,
  listOwnedBy: base.listOwnedBy,
  create: base.create,
  update: base.update,
  remove: base.remove
};

export async function findLeadById(id: string): Promise<LeadRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Lead.findByPk(id, { include: LEAD_INCLUDES() });
  return row ? toLeadRecord(row) : undefined;
}

// Whether this viewer may act on a lead (edit it, log a follow-up, convert it
// to a project) — as opposed to merely see it in a list.
//
// canAccessOwnedRecord() alone is not enough now that leads are assignable:
// it only knows about created_by + department scope, so a rep who was handed a
// lead they didn't capture would find it in their list and then get a 403 the
// moment they tried to work it. The assignee is exactly the person expected to
// act on it, so being assigned has to grant write access as well as read.
export async function canWorkLead(
  viewerUsername: string,
  lead: { created_by: string; assigned_to: string }
): Promise<boolean> {
  if (lead.assigned_to && lead.assigned_to === viewerUsername) return true;
  return canAccessOwnedRecord(viewerUsername, lead.created_by);
}

export interface AssignLeadsResult {
  assigned: number;
  failed: string[];
}

// Assigns (or, with assigneeId === '', unassigns) one or more leads in a
// single call — the Leads view offers both a per-row action and a bulk
// "assign N selected", and both land here so the two can't drift apart.
// Authorisation is the caller's job (see app/api/leads/assign/route.ts);
// this only writes.
export async function assignLeads(
  leadIds: string[],
  assigneeId: string,
  assignerUsername: string
): Promise<AssignLeadsResult> {
  const assigner = assignerUsername
    ? await db.User.findOne({ where: { username: assignerUsername } as never, attributes: ['id'] })
    : null;
  const now = new Date().toISOString();
  const failed: string[] = [];
  let assigned = 0;

  for (const id of leadIds) {
    if (!isUuid(id)) {
      failed.push(id);
      continue;
    }
    const updated = await base.update(id, {
      assigned_to_id: assigneeId,
      // Clearing the assignee clears the provenance too, so an unassigned
      // lead never shows a stale "assigned by X on <date>".
      assigned_by_id: assigneeId ? ((assigner?.get('id') as string) ?? '') : '',
      assigned_at: assigneeId ? now : '',
      updated_at: now
    } as Partial<LeadRecord>);
    if (updated) assigned += 1;
    else failed.push(id);
  }

  return { assigned, failed };
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
    project_id: '',
    // A freshly captured lead is unassigned — a sales manager routes it.
    assigned_to_id: '',
    assigned_by_id: '',
    assigned_at: '',
    assigned_to: '',
    assigned_to_name: '',
    assigned_by: ''
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
  /** Captured but not yet routed to a rep — the sales manager's queue. */
  unassigned: number;
  /** Assigned to the viewer personally. */
  assignedToMe: number;
}

export async function computeLeadStats(viewerUsername: string, viewerIsPrivileged: boolean): Promise<LeadStats> {
  const leads = await listLeads(viewerUsername, viewerIsPrivileged);
  const todayStr = new Date().toDateString();
  return {
    total: leads.length,
    today: leads.filter((l) => new Date(l.created_at).toDateString() === todayStr).length,
    hot: leads.filter((l) => l.priority === 'hot').length,
    unattended: leads.filter(isLeadUnattended).length,
    unassigned: leads.filter((l) => !l.assigned_to_id).length,
    assignedToMe: leads.filter((l) => l.assigned_to === viewerUsername).length
  };
}
