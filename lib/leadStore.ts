import type { Model } from 'sequelize';
import { Op } from 'sequelize';
import { DomainKey, LeadOrigin, LeadPriority, LeadRecord, LeadSource, MetaLeadFieldDatum } from './types';
import { createRecordStore } from './recordStore';
import { db, isUuid } from './db';
import { isLeadUnattended } from './followUp';
import { resolveVisibilityScope, canAccessOwnedRecord } from './departmentScope';
import { isSalesLeadManager } from './permissions';
import { FILTER_MINE, FILTER_UNASSIGNED, FILTER_UNSET } from './leadFilters';
import { todayDateInputValue } from './dateHelpers';

function unionStrings(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

const LEAD_FIELDS = [
  { name: 'updated_at', kind: 'date' as const, column: 'updatedAt' },
  { name: 'name' },
  { name: 'mobile' },
  { name: 'alt_mobile' },
  { name: 'email' },
  { name: 'designation' },
  { name: 'company' },
  { name: 'city' },
  { name: 'company_address' },
  { name: 'reference' },
  { name: 'card_image_url' },
  { name: 'interests', kind: 'json' as const },
  { name: 'sub_interests', kind: 'json' as const },
  { name: 'priority', kind: 'nullable' as const },
  { name: 'follow_up_actions', kind: 'json' as const },
  { name: 'budget' },
  { name: 'notes' },
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'source' },
  { name: 'lead_source' },
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
  { name: 'meta_raw_field_data', kind: 'json' as const },
  { name: 'assigned_to_id', kind: 'nullable' as const },
  { name: 'assigned_by_id', kind: 'nullable' as const },
  { name: 'assigned_at', kind: 'date' as const },
  { name: 'call_outcome' },
  { name: 'called_at', kind: 'date' as const },
  { name: 'called_by_id', kind: 'nullable' as const },
  { name: 'call_remark' },
  { name: 'callback_at', kind: 'nullable' as const }
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
  { model: db.User, as: 'assigner', attributes: ['id', 'username'] },
  { model: db.User, as: 'caller', attributes: ['id', 'username', 'name'] }
];

function toLeadRecord(row: Model): LeadRecord {
  const record = base.toRecord(row);
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const assignee = plain.assignee as { username?: string; name?: string } | null;
  const assigner = plain.assigner as { username?: string } | null;
  const caller = plain.caller as { username?: string; name?: string } | null;
  return {
    ...record,
    assigned_to: assignee?.username ?? '',
    assigned_to_name: assignee?.name || assignee?.username || '',
    assigned_by: assigner?.username ?? '',
    called_by_name: caller?.name || caller?.username || ''
  };
}

// Marketing sees every lead — InfoComm, Meta Lead Ads, any source — whoever
// captured or was assigned it. Deliberately NOT the global viewAllDepartments
// capability (lib/permissions.ts): that would also open Quotations, Projects,
// Site Visits and Delivery Challans to Marketing, none of which was asked
// for. Scoped to this one role, this one record type, by role key rather
// than a capability flag since there is no per-module equivalent of
// viewAllDepartments to hang it on today.
async function isMarketingRole(viewerUsername: string): Promise<boolean> {
  const user = await db.User.findOne({ where: { username: viewerUsername } as never, include: [{ model: db.Role, as: 'role', attributes: ['key'] }] });
  const plain = user?.get({ plain: true }) as { role?: { key?: string } | null } | undefined;
  return plain?.role?.key === 'marketing';
}

// Who sees every lead regardless of who captured or was assigned it:
// Marketing (above), and a manager of either Sales department.
//
// Sales managers are the people expected to route incoming leads, so they
// have to be able to see the ones nobody owns yet. They could not: a Meta
// Lead Ads import that resolves no owner leaves created_by AND
// assigned_to_id both NULL (lib/metaLeadIngest.ts deliberately lands the
// lead anyway rather than losing it), and in SQL NULL matches neither arm of
// the scope filter below — so those leads were invisible to exactly the
// people meant to triage them, while still counting in nobody's queue.
// Uses canAssignLeads' own Sales / GEM - Sales department-manager
// definition, so visibility can't diverge from routing rights.
async function seesAllLeads(viewerUsername: string): Promise<boolean> {
  if (await isMarketingRole(viewerUsername)) return true;
  return isSalesLeadManager(viewerUsername);
}

// Visibility is department scope OR assignment OR an org-wide viewer above.
// The base store filters on created_by alone, which would mean a manager
// could assign a lead to a rep who then couldn't open it — the rep didn't
// capture it and may sit outside the capturer's department scope. Assignment
// has to grant access or the feature doesn't work.
/**
 * Which leads this viewer may see.
 *
 * Extracted so the badge read below cannot drift from the list read: a badge
 * counting leads its owner is not allowed to open would be a permission leak
 * expressed as a number.
 */
async function leadVisibilityWhere(viewerUsername: string): Promise<Record<string | symbol, unknown>> {
  const scope = await resolveVisibilityScope(viewerUsername);
  const where: Record<string | symbol, unknown> = {};
  if (scope.scopedUserIds && !(await seesAllLeads(viewerUsername))) {
    where[Op.or] = [
      { created_by: { [Op.in]: scope.scopedUserIds } },
      { assigned_to_id: { [Op.in]: scope.scopedUserIds } }
    ];
  }
  return where;
}

/** Just enough of a lead for isLeadUnattended and the unassigned count. */
const BADGE_ATTRIBUTES = [
  'id',
  'createdAt',
  'assigned_to_id',
  'assigned_at',
  'project_id',
  'call_outcome',
  'called_at',
  'callback_at',
  'follow_up_actions'
];

/**
 * The leads behind the sidebar's Leads badge, and nothing more.
 *
 * GET /api/sidebar runs on EVERY page load, and read every lead the viewer
 * could see — all 45 columns, four user joins — to produce two integers: the
 * viewer's own unattended leads, and the unassigned backlog for whoever
 * routes them.
 *
 * Deliberately not a pair of SQL COUNTs. "Unattended" is lib/followUp.ts's
 * isLeadUnattended, a rule over eight fields with its own tests, and a second
 * copy of it in SQL would be free to drift from the one the Leads screen
 * shows — the badge and the list would then disagree about the same lead.
 * So the rule stays in one place, in JavaScript, and this stops fetching the
 * 36 columns and the joins it never consults.
 *
 * Returns LeadRecord because the shared mapper formats a missing attribute
 * into its empty value, the same convention as every other bulk read here.
 * Only the fields above are populated; nothing but the badge should use it.
 */
export async function listLeadsForBadges(viewerUsername: string): Promise<LeadRecord[]> {
  const rows = await db.Lead.findAll({
    where: (await leadVisibilityWhere(viewerUsername)) as never,
    attributes: BADGE_ATTRIBUTES
  });
  return rows.map((row) => base.toRecord(row));
}

/** Same fields as BADGE_ATTRIBUTES, plus the two buildSalesTeamSummary also needs. */
const DASHBOARD_ATTRIBUTES = [...BADGE_ATTRIBUTES, 'created_by', 'source'];

/**
 * REL-PERF-001: the Dashboard's own lead read, scoped to exactly what it
 * consumes — the same four counts/filters GET /api/sidebar's badge already
 * gets from listLeadsForBadges above (now also including the fields
 * buildSalesTeamSummary needs for a Sales-leadership viewer: `created_by`
 * and `source`), instead of the full 45-column, four-join read every other
 * list caller needs. Measured at 1306ms of the Dashboard's ~3s load before
 * this change — the full LEAD_INCLUDES() join set (creator, assignee,
 * assigner, caller) and 36 unused columns, read on every single Dashboard
 * load, for what turns into 2-4 integers for most viewers.
 *
 * Only the `creator` and `assignee` joins are kept (assigner/caller are
 * dropped) — buildSalesTeamSummary's `assigned_to || created_by` fallback
 * needs both of those usernames to key its roster map; the other two were
 * never read by anything this route does.
 *
 * Deliberately NOT a SQL aggregate for the same reason listLeadsForBadges
 * isn't one: isLeadUnattended is a JS rule with its own tests, and
 * buildSalesTeamSummary's per-rep crediting logic is a real loop with real
 * business rules (see its own file) — reimplementing either in SQL risks
 * the two silently drifting from what the Leads screen itself shows. This
 * keeps the exact same logic, just over far fewer columns.
 */
async function listLeadsForDashboard(viewerUsername: string): Promise<LeadRecord[]> {
  const rows = await db.Lead.findAll({
    where: (await leadVisibilityWhere(viewerUsername)) as never,
    include: [
      { model: db.User, as: 'creator', attributes: ['id', 'username'] },
      { model: db.User, as: 'assignee', attributes: ['id', 'username'] }
    ],
    attributes: DASHBOARD_ATTRIBUTES
  });
  return rows.map((row) => toLeadRecord(row));
}

async function listLeads(viewerUsername: string, _viewerIsPrivileged: boolean): Promise<LeadRecord[]> {
  const where = await leadVisibilityWhere(viewerUsername);
  const rows = await db.Lead.findAll({
    where: where as never,
    include: LEAD_INCLUDES(),
    order: [['created_at', 'DESC']],
    // meta_raw_field_data is the raw Meta lead-form payload, kept on the row
    // deliberately so nothing an unmapped form field carries is lost (see
    // lib/metaLeadIngest.ts). Nothing READS it: no screen, no export, no
    // report, no analytics — grep the repo and the only hits are this store,
    // the ingest that writes it, and the type.
    //
    // Measured at 378 kB across 1,262 leads, which was 38% of this query's
    // payload. And this read has ten callers, GET /api/sidebar and GET
    // /api/dashboard among them, so every page load in the app was carrying
    // it — then again on the Leads screen's 60s auto-refresh.
    //
    // Excluded from the BULK read only. findLeadById and findLeadsByIds still
    // return the column in full, which is where a single-lead view would read
    // it from, so nothing has to change here if one is ever added.
    attributes: { exclude: ['meta_raw_field_data'] }
  });
  // Emptied rather than left undefined, so a LeadRecord from this read still
  // satisfies its own type. Same convention as projectStore's notes, timeline
  // and last_remark: a bulk list read leaves the expensive fields empty and
  // the single-record read populates them.
  return rows.map((row) => ({ ...toLeadRecord(row), meta_raw_field_data: [] }));
}

export interface LeadListQuery {
  search?: string;
  priority?: LeadPriority;
  interest?: DomainKey;
  source?: LeadSource;
  /** Only applied while source === 'meta_lead_ads', same as the screen's own rule. */
  metaForm?: string;
  metaCampaign?: string;
  /** A real lead_source value, or lib/leadFilters.ts's FILTER_UNSET. */
  origin?: string;
  /** A LeadCallOutcome, or 'to-call' / 'callback-due'. */
  callOutcome?: string;
  unattendedOnly?: boolean;
  /** A user id, or lib/leadFilters.ts's FILTER_UNASSIGNED / FILTER_MINE. */
  assignee?: string;
  sortBy?: 'newest' | 'oldest' | 'name';
  page?: number;
  pageSize?: number;
}

export interface LeadListPage {
  leads: LeadRecord[];
  total: number;
}

const MAX_LEAD_PAGE_SIZE = 200;

/** Narrow attributes for the two JS-only derived filters below — same shape as BADGE_ATTRIBUTES, for the same reason. */
const CALL_DERIVED_ATTRIBUTES = ['id', 'call_outcome', 'assigned_to_id', 'project_id', 'callback_at', 'called_at', 'assigned_at', 'createdAt'];

/**
 * The Leads screen's list, filtered and paginated on the SERVER.
 *
 * Replaces shipping every visible lead to the browser so it can filter 1,262+
 * rows across ten-odd dimensions on every keystroke (components/
 * LeadsView.tsx used to do exactly that). Every filter below is applied as a
 * real SQL WHERE condition EXCEPT unattendedOnly and callOutcome === 'to-call'
 * — both are derived rules that intentionally live in exactly one place
 * (lib/followUp.ts's isLeadUnattended; isMyCallRow above, which mirrors
 * LeadsView's own former leadIsMyCall) rather than a second, SQL copy that
 * could quietly drift from it. For those two, a lightweight id-only query
 * (CALL_DERIVED_ATTRIBUTES, same idea as BADGE_ATTRIBUTES) runs first, scoped
 * by every OTHER filter already applied, and its matching ids narrow the
 * real query — so the one-off extra pass only ever runs over the already-
 * narrowed candidate set, not the full table, except when one of these two
 * is the ONLY filter in play.
 */
async function listLeadsFiltered(
  viewerUsername: string,
  viewerUserId: string,
  canAssign: boolean,
  query: LeadListQuery
): Promise<LeadListPage> {
  const and: Record<string | symbol, unknown>[] = [await leadVisibilityWhere(viewerUsername)];

  const search = (query.search || '').trim();
  if (search) {
    const needle = `%${search}%`;
    and.push({
      [Op.or]: ['name', 'company', 'city', 'email', 'mobile', 'alt_mobile'].map((col) => ({ [col]: { [Op.iLike]: needle } }))
    });
  }
  if (query.priority) and.push({ priority: query.priority });
  if (query.interest) and.push({ interests: { [Op.contains]: [query.interest] } });
  if (query.source) and.push({ source: query.source });
  if (query.source === 'meta_lead_ads') {
    if (query.metaForm) and.push({ meta_form_name: query.metaForm });
    if (query.metaCampaign) and.push({ meta_campaign_name: query.metaCampaign });
  }
  if (query.origin) {
    and.push(query.origin === FILTER_UNSET ? { lead_source: { [Op.or]: [null, ''] } } : { lead_source: query.origin });
  }
  if (query.assignee === FILTER_UNASSIGNED) and.push({ assigned_to_id: null });
  else if (query.assignee === FILTER_MINE) and.push({ assigned_to_id: viewerUserId });
  else if (query.assignee) and.push({ assigned_to_id: query.assignee });

  const todayKey = todayDateInputValue();
  if (query.callOutcome === 'callback-due') {
    and.push({ call_outcome: 'callback', callback_at: { [Op.ne]: null, [Op.lte]: todayKey } });
  } else if (query.callOutcome && query.callOutcome !== 'to-call') {
    and.push({ call_outcome: query.callOutcome });
  }

  if (query.unattendedOnly || query.callOutcome === 'to-call') {
    const candidateWhere = { [Op.and]: [...and] };
    const candidates = await db.Lead.findAll({ where: candidateWhere as never, attributes: CALL_DERIVED_ATTRIBUTES });
    const plain = candidates.map((row) => {
      const p = row.get({ plain: true }) as {
        id: string;
        call_outcome: string;
        assigned_to_id: string | null;
        project_id: string | null;
        callback_at: string | null;
        called_at: Date | string | null;
        assigned_at: Date | string | null;
        createdAt: Date | string;
      };
      return {
        id: p.id,
        call_outcome: p.call_outcome,
        assigned_to_id: p.assigned_to_id,
        project_id: p.project_id,
        callback_at: p.callback_at,
        called_at: p.called_at ? new Date(p.called_at).toISOString() : '',
        assigned_at: p.assigned_at ? new Date(p.assigned_at).toISOString() : '',
        created_at: new Date(p.createdAt).toISOString()
      };
    });
    const matching = plain.filter((l) => {
      if (query.unattendedOnly && !isLeadUnattended({ ...l, assigned_to_id: l.assigned_to_id ?? undefined, project_id: l.project_id ?? undefined, callback_at: l.callback_at ?? undefined, follow_up_actions: [] })) return false;
      if (query.callOutcome === 'to-call' && !isMyCallRow(l, viewerUserId, canAssign)) return false;
      return true;
    });
    // An impossible id rather than an empty IN(), which Sequelize/Postgres
    // would otherwise need to special-case — matches 0 rows either way.
    and.push({ id: { [Op.in]: matching.length ? matching.map((l) => l.id) : ['00000000-0000-0000-0000-000000000000'] } });
  }

  const where = { [Op.and]: and };
  const order: [string, string][] =
    query.sortBy === 'name' ? [['name', 'ASC']] : query.sortBy === 'oldest' ? [['created_at', 'ASC']] : [['created_at', 'DESC']];
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.min(MAX_LEAD_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize || 20)));

  const [total, rows] = await Promise.all([
    db.Lead.count({ where: where as never }),
    db.Lead.findAll({
      where: where as never,
      include: LEAD_INCLUDES(),
      order: order as never,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      // Same exclusion as listLeads, same reason.
      attributes: { exclude: ['meta_raw_field_data'] }
    })
  ]);

  return { leads: rows.map((row) => ({ ...toLeadRecord(row), meta_raw_field_data: [] })), total };
}

export const leadStore = {
  list: listLeads,
  listForDashboard: listLeadsForDashboard,
  listFiltered: listLeadsFiltered,
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

// The same read for a whole batch, in one query — used after a bulk assign,
// where calling findLeadById per lead would mean 600 more round trips.
export async function findLeadsByIds(ids: string[]): Promise<LeadRecord[]> {
  const valid = ids.filter(isUuid);
  if (!valid.length) return [];
  const rows = await db.Lead.findAll({ where: { id: valid } as never, include: LEAD_INCLUDES() });
  return rows.map(toLeadRecord);
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
  if (await seesAllLeads(viewerUsername)) return true;
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
  assignerUsername: string,
  // Set by a self-claim ("take this unassigned lead for myself"): adds
  // assigned_to_id IS NULL to the WHERE clause so two reps claiming the same
  // card at once can't both win — the loser's row just doesn't match, same
  // as any other lost-race case below, instead of silently overwriting
  // whichever rep claimed it a moment earlier. A manager's ordinary
  // reassignment is NOT guarded this way — overwriting the existing owner is
  // exactly what that action is for.
  options?: { requireCurrentlyUnassigned?: boolean }
): Promise<AssignLeadsResult> {
  const assigner = assignerUsername
    ? await db.User.findOne({ where: { username: assignerUsername } as never, attributes: ['id'] })
    : null;
  const now = new Date();
  const failed = leadIds.filter((id) => !isUuid(id));
  const ids = leadIds.filter((id) => isUuid(id));
  if (!ids.length) return { assigned: 0, failed };

  // ONE update for the whole batch. This used to be a read-modify-write per
  // lead (three queries each), which for an expo's 600 cards meant ~1,800
  // sequential round trips in a single request — it timed out long before it
  // finished. Written straight through the model rather than via
  // recordStore.update for the same reason.
  const where: Record<string, unknown> = { id: ids };
  if (options?.requireCurrentlyUnassigned) where.assigned_to_id = null;
  const [assigned] = await db.Lead.update(
    {
      assigned_to_id: assigneeId || null,
      // Clearing the assignee clears the provenance too, so an unassigned
      // lead never shows a stale "assigned by X on <date>".
      assigned_by_id: assigneeId ? ((assigner?.get('id') as string) ?? null) : null,
      assigned_at: assigneeId ? now : null,
      updated_at: now
    } as never,
    { where: where as never }
  );

  // Anything that didn't match is reported the same way the per-lead loop
  // used to report it. For a plain (non-claim) assignment, "didn't match"
  // only means the row is gone (deleted, or never existed). For a self-claim,
  // it can ALSO mean someone else claimed it a moment ago — the WHERE clause
  // excludes that row from the UPDATE, but it still exists, so the ordinary
  // "was it found at all" check below would wrongly call it a success. Check
  // the actual resulting owner instead so a lost race is reported as failed,
  // not silently credited to the loser.
  if (assigned < ids.length) {
    if (options?.requireCurrentlyUnassigned) {
      const found = await db.Lead.findAll({ where: { id: ids } as never, attributes: ['id', 'assigned_to_id'] });
      const ownerById = new Map(found.map((r) => [r.get('id') as string, r.get('assigned_to_id') as string | null]));
      failed.push(...ids.filter((id) => ownerById.get(id) !== (assigneeId || null)));
    } else {
      const found = await db.Lead.findAll({ where: { id: ids } as never, attributes: ['id'] });
      const foundIds = new Set(found.map((r) => r.get('id') as string));
      failed.push(...ids.filter((id) => !foundIds.has(id)));
    }
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
  // Optional — omitted entirely by callers that don't collect it (bulk
  // import), defaults to '' same as every other optional string field here.
  altMobile?: string;
  email: string;
  designation: string;
  company: string;
  city: string;
  // Both optional — omitted entirely by callers that don't collect them
  // (bulk import, Meta), same default-to-'' treatment as altMobile above.
  companyAddress?: string;
  reference?: string;
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
  // Where the lead came from — the API layer makes this mandatory for a human
  // capture; the Meta pipeline supplies 'meta_leads' itself. Optional here so
  // the merge path, which never rewrites an existing lead's origin, is
  // unaffected.
  leadSource?: LeadOrigin;
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
      alt_mobile: input.altMobile || duplicate.alt_mobile,
      email: input.email || duplicate.email,
      designation: input.designation || duplicate.designation,
      city: input.city || duplicate.city,
      company_address: input.companyAddress || duplicate.company_address,
      reference: input.reference || duplicate.reference,
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
    alt_mobile: input.altMobile || '',
    email: input.email,
    designation: input.designation,
    company: input.company,
    city: input.city,
    company_address: input.companyAddress || '',
    reference: input.reference || '',
    card_image_url: input.cardImageUrl,
    interests: input.interests,
    sub_interests: input.subInterests,
    priority: input.priority,
    follow_up_actions: input.followUpActions,
    budget: input.budget,
    notes: input.notes,
    project_id: '',
    source: input.source || 'manual',
    lead_source: input.leadSource || (input.meta ? 'meta_leads' : ''),
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
    meta_raw_field_data: input.meta?.rawFieldData || [],
    // A freshly captured lead is unassigned — a sales manager routes it.
    assigned_to_id: '',
    assigned_by_id: '',
    assigned_at: '',
    assigned_to: '',
    assigned_to_name: '',
    assigned_by: '',
    // Nobody has called a brand-new lead yet (lib/leadCall.ts).
    call_outcome: '',
    called_at: '',
    called_by_id: '',
    called_by_name: '',
    call_remark: '',
    callback_at: ''
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
// `leadSource` is the origin picked once for the whole batch — a CSV or a
// folder of card photos comes from one event, so asking per row would be
// noise. The route makes it mandatory, the same as a single capture.
export async function commitBulkLeads(rows: BulkLeadRow[], actorUsername: string, source: LeadSource = 'csv_import', leadSource: LeadOrigin = ''): Promise<BulkLeadCommitSummary> {
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
        source,
        leadSource
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
  /** Captured but not yet routed to a rep — the sales manager's queue. */
  unassigned: number;
  /** Assigned to the viewer personally. */
  assignedToMe: number;
  /**
   * lead_source -> count, over every lead the viewer can see. Moved here
   * (previously computed in components/LeadsView.tsx from the fully-loaded
   * list) so the Leads screen's origin chip row no longer needs the whole
   * table in the browser to render — see lib/leadFilters.ts's FILTER_UNSET
   * for the "no source recorded" bucket's key.
   */
  originCounts: Record<string, number>;
  /** Same reasoning as originCounts — the call-outcome funnel tiles. */
  callStats: { toCall: number; suitable: number; notSuitable: number; completed: number; callbackDue: number };
  /** Distinct Form/Campaign names across the viewer's Meta Lead Ads leads — the "Where from: Meta" filter's two dropdowns. */
  metaFormOptions: string[];
  metaCampaignOptions: string[];
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
  const leads = (await listLeads(viewerUsername, viewerIsPrivileged)).filter((l) => l.source === 'meta_lead_ads');
  return {
    total: leads.length,
    byPlatform: countBy(leads, (l) => l.meta_platform, (key) => (key === 'ig' ? 'Instagram' : key === 'fb' ? 'Facebook' : 'Unknown')),
    byCampaign: countBy(leads, (l) => l.meta_campaign_id, (_key, l) => l.meta_campaign_name || 'Unnamed campaign'),
    byForm: countBy(leads, (l) => l.meta_form_id, (_key, l) => l.meta_form_name || 'Unnamed form'),
    byStatus: countBy(leads, (l) => (l.project_id ? 'converted' : 'new'), (key) => (key === 'converted' ? 'Converted to Project' : 'New')),
    byAssignedUser: countBy(leads, (l) => l.assigned_to || l.created_by, (key) => key),
    convertedToProject: leads.filter((l) => l.project_id).length
  };
}

// The rep's queue: handed to somebody, nobody has called yet, and it isn't
// already a project. Mirrors components/LeadsView.tsx's leadNeedsCall/
// canLogCall/leadIsMyCall exactly (comment there explains why that copy
// exists instead of importing canLogLeadCall from lib/leadCall.ts: once a
// lead has passed the visibility WHERE clause it is already in scope, so the
// only remaining questions are "is it mine / unassigned / can I assign
// generally" — the same simplification applies here, for the same reason,
// and keeps this aggregate a single query instead of one canLogLeadCall()
// per lead.
function leadNeedsCallRow(lead: { call_outcome: string; assigned_to_id?: string | null; project_id?: string | null }): boolean {
  return !lead.call_outcome && !!lead.assigned_to_id && !lead.project_id;
}
function isMyCallRow(
  lead: { call_outcome: string; assigned_to_id?: string | null; project_id?: string | null },
  viewerUserId: string,
  canAssign: boolean
): boolean {
  if (!leadNeedsCallRow(lead)) return false;
  if (lead.project_id) return false;
  if (lead.assigned_to_id === viewerUserId) return true;
  if (!lead.assigned_to_id) return true;
  return canAssign;
}

export async function computeLeadStats(viewerUsername: string, viewerIsPrivileged: boolean, viewerUserId: string, canAssign: boolean): Promise<LeadStats> {
  const leads = await listLeads(viewerUsername, viewerIsPrivileged);
  const todayStr = new Date().toDateString();
  const metaLeads = leads.filter((l) => l.source === 'meta_lead_ads');
  const todayKey = todayDateInputValue();

  const originCounts: Record<string, number> = {};
  for (const l of leads) {
    const key = l.lead_source || FILTER_UNSET;
    originCounts[key] = (originCounts[key] ?? 0) + 1;
  }

  const callStats = { toCall: 0, suitable: 0, notSuitable: 0, completed: 0, callbackDue: 0 };
  for (const l of leads) {
    if (l.call_outcome === 'suitable') callStats.suitable += 1;
    else if (l.call_outcome === 'not_suitable') callStats.notSuitable += 1;
    else if (l.call_outcome === 'completed') callStats.completed += 1;
    else if (l.call_outcome === 'callback') {
      if (l.callback_at && l.callback_at <= todayKey) callStats.callbackDue += 1;
    } else if (isMyCallRow(l, viewerUserId, canAssign)) callStats.toCall += 1;
  }

  return {
    total: leads.length,
    today: leads.filter((l) => new Date(l.created_at).toDateString() === todayStr).length,
    hot: leads.filter((l) => l.priority === 'hot').length,
    unattended: leads.filter(isLeadUnattended).length,
    metaTotal: metaLeads.length,
    metaToday: metaLeads.filter((l) => new Date(l.created_at).toDateString() === todayStr).length,
    unassigned: leads.filter((l) => !l.assigned_to_id).length,
    assignedToMe: leads.filter((l) => l.assigned_to === viewerUsername).length,
    originCounts,
    callStats,
    metaFormOptions: Array.from(new Set(metaLeads.map((l) => l.meta_form_name).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    metaCampaignOptions: Array.from(new Set(metaLeads.map((l) => l.meta_campaign_name).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  };
}
