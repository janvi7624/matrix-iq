import { Model, UniqueConstraintError } from 'sequelize';
import { PartnerRecord, PartnerStatus, PartnerFinancialDetailsScope } from './types';
import { db, isUuid } from './db';
import { partnerCodePrefix } from './partnerCode';

// Partner company master. Phase 0 scope: the reads the access layer needs
// (resolve a partner, decide whether it may be used) plus code generation.
// The internal management surface — create/edit/suspend, sub-user accounts,
// invitations — lands in Phase 1 and builds on these.

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function toRecord(row: Model): PartnerRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    partner_code: (plain.partner_code as string) ?? '',
    company_name: (plain.company_name as string) ?? '',
    contact_person: (plain.contact_person as string) ?? '',
    email: (plain.email as string) ?? '',
    phone: (plain.phone as string) ?? '',
    address: (plain.address as string) ?? '',
    city: (plain.city as string) ?? '',
    state: (plain.state as string) ?? '',
    country: (plain.country as string) ?? '',
    gst_number: (plain.gst_number as string) ?? '',
    status: ((plain.status as PartnerStatus) ?? 'pending') as PartnerStatus,
    departments: stringList(plain.departments),
    product_categories: stringList(plain.product_categories),
    territory: stringList(plain.territory),
    relationship_manager_id: (plain.relationship_manager_id as string) ?? '',
    relationship_manager_name: (plain.relationshipManager as { name?: string } | null)?.name ?? '',
    notes: (plain.notes as string) ?? '',
    website: (plain.website as string) ?? '',
    pan_number: (plain.pan_number as string) ?? '',
    bank_account_name: (plain.bank_account_name as string) ?? '',
    bank_account_number: (plain.bank_account_number as string) ?? '',
    bank_ifsc_code: (plain.bank_ifsc_code as string) ?? '',
    bank_name: (plain.bank_name as string) ?? '',
    financial_details_scope: ((plain.financial_details_scope as PartnerFinancialDetailsScope) ?? 'internal') as PartnerFinancialDetailsScope,
    created_by: (plain.created_by as string) ?? '',
    created_by_name:
      (plain.creator as { name?: string; username?: string } | null)?.name
      ?? (plain.creator as { username?: string } | null)?.username
      ?? '',
    onboarded_at: isoOrEmpty(plain.onboarded_at),
    created_at: isoOrEmpty(plain.createdAt),
    updated_at: isoOrEmpty(plain.updatedAt)
  };
}

const rmInclude = { model: db.User, as: 'relationshipManager', attributes: ['id', 'name', 'username'] };
// Needed for created_by_name — the onboarding screens name the person who
// created the account, because they are the one who approves its documents.
const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'name', 'username'] };

export async function findPartnerById(id: string): Promise<PartnerRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Partner.findByPk(id, { include: [rmInclude, creatorInclude] });
  return row ? toRecord(row) : undefined;
}

/**
 * The one place that decides whether a partner company may use the portal
 * right now. Both the page guard and every partner API route go through it,
 * so "can't see the page" and "can't call the API" can never drift apart —
 * the same one-rule-two-consumers arrangement AUDIT_LOG_ROLES uses in
 * lib/permissions.ts.
 *
 * Fails closed: an unknown status is not active.
 */
export function isPartnerUsable(status: PartnerStatus | string): boolean {
  return status === 'active';
}

export async function listPartners(): Promise<PartnerRecord[]> {
  const rows = await db.Partner.findAll({ include: [rmInclude, creatorInclude], order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

export interface PartnerInput {
  company_name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  gst_number?: string;
  departments?: string[];
  product_categories?: string[];
  territory?: string[];
  relationship_manager_id?: string | null;
  notes?: string;
  website?: string;
  pan_number?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  bank_ifsc_code?: string;
  bank_name?: string;
  financial_details_scope?: PartnerFinancialDetailsScope;
}

export async function createPartner(input: PartnerInput, createdByUserId: string): Promise<PartnerRecord> {
  // partner_code is computed from a read-everything/find-max/+1 scan
  // (nextPartnerCode), which two concurrent creates can race to the same
  // value for — the DB's unique constraint then rejects the loser. Self-heal
  // by regenerating a fresh code and retrying, instead of surfacing that as a
  // raw validation-error 500 to whichever request lost the race.
  let code = await nextPartnerCode(input.departments || []);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const row = await createPartnerRow(input, createdByUserId, code);
      return (await findPartnerById(row.get('id') as string)) as PartnerRecord;
    } catch (error) {
      const isCodeCollision =
        error instanceof UniqueConstraintError &&
        Object.keys((error as UniqueConstraintError).fields || {}).includes('partner_code');
      if (!isCodeCollision || attempt === 2) throw error;
      code = await nextPartnerCode(input.departments || []);
    }
  }
  // Unreachable — the loop above always returns or throws.
  throw new Error('Failed to create partner');
}

async function createPartnerRow(input: PartnerInput, createdByUserId: string, code: string) {
  return db.Partner.create({
    partner_code: code,
    company_name: input.company_name,
    contact_person: input.contact_person || '',
    email: input.email || '',
    phone: input.phone || '',
    address: input.address || '',
    city: input.city || '',
    state: input.state || '',
    country: input.country || '',
    gst_number: input.gst_number || '',
    // A new partner starts 'pending' and cannot sign in. It becomes 'active'
    // when its first login is created (lib/partnerUserStore.ts) — so an
    // account that exists but has nobody to use it can never be mistaken for
    // a live relationship.
    status: 'pending',
    departments: input.departments || [],
    product_categories: input.product_categories || [],
    territory: input.territory || [],
    relationship_manager_id: input.relationship_manager_id || null,
    notes: input.notes || '',
    website: input.website || '',
    pan_number: input.pan_number || '',
    bank_account_name: input.bank_account_name || '',
    bank_account_number: input.bank_account_number || '',
    bank_ifsc_code: input.bank_ifsc_code || '',
    bank_name: input.bank_name || '',
    // Defaults 'internal' — today's behaviour for every existing partner:
    // an admin/RM fills these in, not the partner. 'partner' is an explicit
    // opt-in at creation (PartnerCreateView's checkbox).
    financial_details_scope: input.financial_details_scope === 'partner' ? 'partner' : 'internal',
    created_by: createdByUserId,
    updated_by: createdByUserId
  } as never);
}

export async function updatePartner(id: string, patch: Partial<PartnerInput>, updatedByUserId: string): Promise<PartnerRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Partner.findByPk(id);
  if (!row) return undefined;
  // partner_code and status are deliberately NOT patchable here: the code is
  // a permanent reference, and status moves only through setPartnerStatus
  // below, which is the one place the transition rules live.
  const fields: Record<string, unknown> = { updated_by: updatedByUserId };
  for (const key of [
    'company_name', 'contact_person', 'email', 'phone', 'address', 'city', 'state', 'country', 'gst_number',
    'departments', 'product_categories', 'territory', 'notes',
    'website', 'pan_number', 'bank_account_name', 'bank_account_number', 'bank_ifsc_code', 'bank_name'
  ] as const) {
    if (patch[key] !== undefined) fields[key] = patch[key];
  }
  if (patch.relationship_manager_id !== undefined) {
    fields.relationship_manager_id = patch.relationship_manager_id || null;
  }
  // Kept out of the blanket loop above: who may set it differs by caller
  // (the partner-facing profile route never sends it — only an admin/RM can
  // move a partner between scopes), not just whether the value is patchable.
  if (patch.financial_details_scope === 'partner' || patch.financial_details_scope === 'internal') {
    fields.financial_details_scope = patch.financial_details_scope;
  }
  await row.update(fields as never);
  return findPartnerById(id);
}

/**
 * The only way a partner's status moves.
 *
 * 'pending' is reachable only at creation — a partner that has had a login
 * issued can never go back to "not set up yet", because the login exists.
 * Everything else is reversible, because suspension is routinely temporary
 * (a payment dispute, a compliance review) and must not destroy anything.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<PartnerStatus, PartnerStatus[]> = {
  pending: ['active', 'inactive'],
  active: ['suspended', 'inactive'],
  suspended: ['active', 'inactive'],
  inactive: ['active']
};

export function canTransitionPartnerStatus(from: PartnerStatus, to: PartnerStatus): boolean {
  return (ALLOWED_STATUS_TRANSITIONS[from] || []).includes(to);
}

export async function setPartnerStatus(id: string, status: PartnerStatus, updatedByUserId: string): Promise<PartnerRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Partner.findByPk(id);
  if (!row) return undefined;
  const from = (row.get('status') as PartnerStatus) || 'pending';
  if (from !== status && !canTransitionPartnerStatus(from, status)) {
    throw new Error(`A ${from} partner cannot be moved to ${status}`);
  }
  // Re-checked against the same `from` read above: without this WHERE, two
  // concurrent status changes off the same stale status (e.g. one admin
  // suspending while another deactivates) would both pass the transition
  // check and both write — the second silently overwrites the first, and
  // the audit log ends up describing an action that isn't what's actually
  // stored.
  const [affected] = await db.Partner.update(
    { status, updated_by: updatedByUserId } as never,
    { where: { id, status: from } as never }
  );
  if (!affected) throw new Error(`A ${from} partner cannot be moved to ${status}`);
  return findPartnerById(id);
}

/**
 * Next partner code, in the series its departments put it in: PTR-AI-####,
 * PTR-ROB-####, PTR-AV-#### for a partner tied to exactly one TMS
 * department, PTR-ALL-#### for one spanning all three, or the plain
 * PTR-#### series (every partner created before this existed, and anything
 * that doesn't cleanly fit one bucket — see partnerCodeSegment).
 *
 * Each series numbers independently, derived from THAT series' highest
 * existing code rather than a row count, so deleting a partner can never
 * cause the next one in its series to reuse a retired code — codes appear in
 * correspondence and must stay stable references. Soft-deleted rows are
 * deliberately included (paranoid: false) for exactly that reason.
 */
export async function nextPartnerCode(departments: readonly string[] = []): Promise<string> {
  const prefix = partnerCodePrefix(departments);
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
  const rows = await db.Partner.findAll({ attributes: ['partner_code'], paranoid: false });
  let max = 0;
  for (const row of rows) {
    const match = pattern.exec((row.get('partner_code') as string) || '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
