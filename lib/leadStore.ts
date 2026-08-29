import { DomainKey, LeadPriority, LeadRecord, LeadSource, MetaLeadFieldDatum } from './types';
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
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'source' },
  { name: 'meta_lead_id', kind: 'nullable' as const },
  { name: 'meta_page_id', kind: 'nullable' as const },
  { name: 'meta_form_id', kind: 'nullable' as const },
  { name: 'meta_form_name', kind: 'nullable' as const },
  { name: 'meta_campaign_id', kind: 'nullable' as const },
  { name: 'meta_campaign_name', kind: 'nullable' as const },
  { name: 'meta_adset_id', kind: 'nullable' as const },
  { name: 'meta_adset_name', kind: 'nullable' as const },
  { name: 'meta_ad_id', kind: 'nullable' as const },
  { name: 'meta_ad_name', kind: 'nullable' as const },
  { name: 'meta_platform', kind: 'nullable' as const },
  { name: 'meta_created_at', kind: 'date' as const },
  { name: 'meta_raw_field_data', kind: 'json' as const }
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
// Meta (Facebook/Instagram) Lead Ads attribution for a single incoming
// lead — set only by lib/metaLeadIngest.ts. Every other caller (manual
// capture, CSV import, business-card scan) omits this entirely.
export interface CreateOrMergeLeadMetaInput {
  leadId: string;
  pageId: string;
  formId: string;
  formName: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  platform: 'fb' | 'ig' | '';
  createdAt: string;
  rawFieldData: MetaLeadFieldDatum[];
}

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
  // Defaults to 'manual' when omitted — every pre-existing call site (single
  // capture, CSV/image bulk import) is unaffected by this addition.
  source?: LeadSource;
  meta?: CreateOrMergeLeadMetaInput;
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

function metaPlatformLabel(platform: 'fb' | 'ig' | ''): string {
  return platform === 'ig' ? 'Instagram' : platform === 'fb' ? 'Facebook' : 'Meta';
}

export async function createOrMergeLead(input: CreateOrMergeLeadInput, actorUsername: string): Promise<CreateOrMergeLeadResult> {
  const now = new Date().toISOString();
  const duplicate = await findDuplicateLead(input.mobile, input.email);
  if (duplicate) {
    // A Meta touch on an existing lead never overwrites its original
    // source/acquisition channel or a Meta attribution it already has
    // (first-touch preserved) — instead it's recorded as a line in notes
    // plus the caller's own audit-log entry, mirroring how a merge already
    // preserves history via notes rather than by replacing fields.
    let notesAddition = '';
    const metaAttribution: Partial<LeadRecord> = {};
    if (input.meta) {
      notesAddition = `Meta touch: "${input.meta.campaignName || input.meta.formName || 'Lead Ad'}" via ${metaPlatformLabel(input.meta.platform)} (Meta Lead ID: ${input.meta.leadId})`;
      if (!duplicate.meta_lead_id) {
        metaAttribution.meta_lead_id = input.meta.leadId;
        metaAttribution.meta_page_id = input.meta.pageId;
        metaAttribution.meta_form_id = input.meta.formId;
        metaAttribution.meta_form_name = input.meta.formName;
        metaAttribution.meta_campaign_id = input.meta.campaignId;
        metaAttribution.meta_campaign_name = input.meta.campaignName;
        metaAttribution.meta_adset_id = input.meta.adsetId;
        metaAttribution.meta_adset_name = input.meta.adsetName;
        metaAttribution.meta_ad_id = input.meta.adId;
        metaAttribution.meta_ad_name = input.meta.adName;
        metaAttribution.meta_platform = input.meta.platform;
        metaAttribution.meta_created_at = input.meta.createdAt;
        metaAttribution.meta_raw_field_data = input.meta.rawFieldData;
      }
    }
    const combinedNotes = notesAddition
      ? (duplicate.notes ? `${duplicate.notes}\n---\n${notesAddition}` : notesAddition)
      : input.notes
        ? (duplicate.notes ? `${duplicate.notes}\n---\n${input.notes}` : input.notes)
        : duplicate.notes;
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
      notes: combinedNotes,
      ...metaAttribution,
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
    source: input.source || 'manual',
    meta_lead_id: input.meta?.leadId || '',
    meta_page_id: input.meta?.pageId || '',
    meta_form_id: input.meta?.formId || '',
    meta_form_name: input.meta?.formName || '',
    meta_campaign_id: input.meta?.campaignId || '',
    meta_campaign_name: input.meta?.campaignName || '',
    meta_adset_id: input.meta?.adsetId || '',
    meta_adset_name: input.meta?.adsetName || '',
    meta_ad_id: input.meta?.adId || '',
    meta_ad_name: input.meta?.adName || '',
    meta_platform: input.meta?.platform || '',
    meta_created_at: input.meta?.createdAt || '',
    meta_raw_field_data: input.meta?.rawFieldData || []
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
export async function commitBulkLeads(rows: BulkLeadRow[], actorUsername: string, source: LeadSource = 'csv_import'): Promise<BulkLeadCommitSummary> {
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
        notes: row.notes,
        source
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

// The idempotency guard lib/metaLeadIngest.ts checks before doing any
// Graph API work — a hit here means this exact Meta lead was already
// ingested (a webhook retry, or the manual "Sync Meta Leads" re-processing
// an event that already succeeded), so ingestion short-circuits instead of
// creating (or merging into) a second record. This is a pre-check only —
// the leads.meta_lead_id unique index is the actual DB-level guarantee
// under true concurrent delivery, see the create() unique-violation catch.
export async function findLeadByMetaLeadId(metaLeadId: string): Promise<LeadRecord | undefined> {
  if (!metaLeadId) return undefined;
  const row = await db.Lead.findOne({ where: { meta_lead_id: metaLeadId } as never });
  return row ? findLeadById(row.get('id') as string) : undefined;
}

export interface LeadStats {
  total: number;
  today: number;
  hot: number;
  unattended: number;
  metaTotal: number;
  metaToday: number;
}

export interface MetaLeadAnalyticsBucket {
  key: string;
  label: string;
  count: number;
}

export interface MetaLeadAnalytics {
  total: number;
  byPlatform: MetaLeadAnalyticsBucket[];
  byCampaign: MetaLeadAnalyticsBucket[];
  byForm: MetaLeadAnalyticsBucket[];
  byStatus: MetaLeadAnalyticsBucket[]; // 'new' (not yet converted) vs 'converted'
  byAssignedUser: MetaLeadAnalyticsBucket[];
  convertedToProject: number;
}

function countBy(leads: LeadRecord[], keyOf: (l: LeadRecord) => string, labelOf: (key: string, l: LeadRecord) => string): MetaLeadAnalyticsBucket[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const l of leads) {
    const key = keyOf(l) || 'unknown';
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { label: labelOf(key, l), count: 1 });
  }
  return Array.from(counts.entries())
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

// Marketing performance view (spec: campaign/form/status/assignee
// breakdown, and how many converted into a Project) — deliberately no
// spend/ROI figures, since Meta ad-spend data isn't part of this
// integration and faking it isn't acceptable.
export async function computeMetaLeadAnalytics(viewerUsername: string, viewerIsPrivileged: boolean): Promise<MetaLeadAnalytics> {
  const leads = (await base.list(viewerUsername, viewerIsPrivileged)).filter((l) => l.source === 'meta_lead_ads');
  return {
    total: leads.length,
    byPlatform: countBy(leads, (l) => l.meta_platform, (key) => (key === 'ig' ? 'Instagram' : key === 'fb' ? 'Facebook' : 'Unknown')),
    byCampaign: countBy(leads, (l) => l.meta_campaign_id, (_key, l) => l.meta_campaign_name || 'Unnamed campaign'),
    byForm: countBy(leads, (l) => l.meta_form_id, (_key, l) => l.meta_form_name || 'Unnamed form'),
    byStatus: countBy(leads, (l) => (l.project_id ? 'converted' : 'new'), (key) => (key === 'converted' ? 'Converted to Project' : 'New')),
    byAssignedUser: countBy(leads, (l) => l.created_by, (key) => key),
    convertedToProject: leads.filter((l) => l.project_id).length
  };
}

export async function computeLeadStats(viewerUsername: string, viewerIsPrivileged: boolean): Promise<LeadStats> {
  const leads = await base.list(viewerUsername, viewerIsPrivileged);
  const todayStr = new Date().toDateString();
  const metaLeads = leads.filter((l) => l.source === 'meta_lead_ads');
  return {
    total: leads.length,
    today: leads.filter((l) => new Date(l.created_at).toDateString() === todayStr).length,
    hot: leads.filter((l) => l.priority === 'hot').length,
    unattended: leads.filter(isLeadUnattended).length,
    metaTotal: metaLeads.length,
    metaToday: metaLeads.filter((l) => new Date(l.created_at).toDateString() === todayStr).length
  };
}
