import { Model } from 'sequelize';
import { PartnerRecord, PartnerStatus } from './types';
import { db, isUuid } from './db';

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
    created_at: isoOrEmpty(plain.createdAt),
    updated_at: isoOrEmpty(plain.updatedAt)
  };
}

const rmInclude = { model: db.User, as: 'relationshipManager', attributes: ['id', 'name', 'username'] };

export async function findPartnerById(id: string): Promise<PartnerRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Partner.findByPk(id, { include: [rmInclude] });
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
  const rows = await db.Partner.findAll({ include: [rmInclude], order: [['created_at', 'DESC']] });
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
}

export async function createPartner(input: PartnerInput, createdByUserId: string): Promise<PartnerRecord> {
  const row = await db.Partner.create({
    partner_code: await nextPartnerCode(),
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
    created_by: createdByUserId,
    updated_by: createdByUserId
  } as never);
  return (await findPartnerById(row.get('id') as string)) as PartnerRecord;
}

export async function updatePartner(id: string, patch: Partial<PartnerInput>, updatedByUserId: string): Promise<PartnerRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Partner.findByPk(id);
  if (!row) return undefined;
  // partner_code and status are deliberately NOT patchable here: the code is
  // a permanent reference, and status moves only through setPartnerStatus
  // below, which is the one place the transition rules live.
  const fields: Record<string, unknown> = { updated_by: updatedByUserId };
  for (const key of ['company_name', 'contact_person', 'email', 'phone', 'address', 'city', 'state', 'country', 'gst_number', 'departments', 'product_categories', 'territory', 'notes'] as const) {
    if (patch[key] !== undefined) fields[key] = patch[key];
  }
  if (patch.relationship_manager_id !== undefined) {
    fields.relationship_manager_id = patch.relationship_manager_id || null;
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
  await row.update({ status, updated_by: updatedByUserId } as never);
  return findPartnerById(id);
}

/**
 * Next partner code in the PTR-#### series.
 *
 * Derived from the highest existing code rather than from a row count, so
 * deleting a partner can never cause the next one to reuse a retired code —
 * codes appear in correspondence and must stay stable references. Soft-deleted
 * rows are deliberately included (paranoid: false) for exactly that reason.
 */
export async function nextPartnerCode(): Promise<string> {
  const rows = await db.Partner.findAll({ attributes: ['partner_code'], paranoid: false });
  let max = 0;
  for (const row of rows) {
    const match = /^PTR-(\d+)$/.exec((row.get('partner_code') as string) || '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `PTR-${String(max + 1).padStart(4, '0')}`;
}
