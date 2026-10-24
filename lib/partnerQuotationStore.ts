import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { QuotationRecord } from './types';
import { computeEffectiveStatusClient, SHAREABLE_QUOTATION_STATUSES } from './quotationStatus';
import { flattenStoredProductGroups, parseStoredProductGroups } from './quotationProductGroups';
import type { LineItem, ProductGroup } from './types';

// Quotation sharing: the internal act of publishing one to a partner, and
// the partner's read-only view of what has been published to them.

export class PartnerShareError extends Error {}

/**
 * Statuses a quotation may be in to be shared.
 *
 * 'draft' is excluded and that is the central rule of this module. A draft
 * is working material — half-entered line items, pricing being argued over
 * internally — and the requirement is explicit that drafts and internal
 * pricing discussions stay restricted. Enforced here, in the store, rather
 * than in the route, so no future caller can share one by taking a different
 * path in.
 */
// Re-exported from the client-safe module so there is one definition: this
// file imports Sequelize and cannot be reached from a 'use client' component.
const SHAREABLE_STATUSES = SHAREABLE_QUOTATION_STATUSES;

export interface PartnerSharedQuotation {
  id: string;
  quotation_number: string;
  revision_number: number;
  // The partner sees the quotation's own lifecycle status, computed the same
  // way the internal list computes it (so an expired quote reads as expired
  // to both sides rather than looking live to the partner).
  status: string;
  created_at: string;
  validity_days: number;
  total: number;
  subtotal: number;
  gst_amount: number;
  discount_total: number;
  client_name: string;
  client_company: string;
  project_vertical: string;
  shared_at: string;
  note: string;
  project_id: string;
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Project a quotation into the partner-safe shape.
 *
 * Allow-list, like lib/partnerVisibility.ts — the internal QuotationRecord
 * carries markup_percent, prepared_by_user_id, internal follow-up history and
 * the raw products_json snapshot. markup_percent in particular is this
 * company's margin, and shipping it to a channel partner would hand them our
 * cost structure.
 */
function toPartnerQuotation(quotation: QuotationRecord, share: { shared_at: string; note: string }): PartnerSharedQuotation {
  return {
    id: quotation.id,
    quotation_number: quotation.quotation_number,
    revision_number: quotation.revision_number ?? 0,
    status: computeEffectiveStatusClient(quotation),
    created_at: quotation.created_at,
    validity_days: quotation.validity_days ?? 0,
    total: Number(quotation.total) || 0,
    subtotal: Number(quotation.subtotal) || 0,
    gst_amount: Number(quotation.gst_amount) || 0,
    discount_total: Number(quotation.discount_total) || 0,
    client_name: quotation.client_name ?? '',
    client_company: quotation.client_company ?? '',
    project_vertical: quotation.project_vertical ?? '',
    shared_at: share.shared_at,
    note: share.note,
    project_id: quotation.project_id ?? ''
  };
}

/** Publish a quotation to a partner. Idempotent: re-sharing a live share updates its note. */
export async function shareQuotationWithPartner(
  quotationId: string,
  partnerId: string,
  sharedByUserId: string,
  note: string
): Promise<void> {
  if (!isUuid(quotationId) || !isUuid(partnerId)) throw new PartnerShareError('Unknown quotation or partner');

  const quotation = await db.Quotation.findByPk(quotationId, { attributes: ['id', 'status', 'project_id'] });
  if (!quotation) throw new PartnerShareError('Quotation not found');

  const status = quotation.get('status') as string;
  if (!SHAREABLE_STATUSES.includes(status)) {
    throw new PartnerShareError('A draft quotation cannot be shared. Finalise it first.');
  }

  // The quotation must belong to a project that is actually this partner's.
  // Without this check a salesperson could share any customer's quotation
  // with any partner — the authorization question "may you share" is
  // separate from "is this theirs to see".
  const projectId = quotation.get('project_id') as string | null;
  if (!projectId) throw new PartnerShareError('This quotation is not linked to a project, so it cannot be shared with a partner.');
  const project = await db.Project.findByPk(projectId, { attributes: ['id', 'partner_id'] });
  if (!project || (project.get('partner_id') as string | null) !== partnerId) {
    throw new PartnerShareError('That quotation belongs to a project this partner did not submit.');
  }

  const existing = await db.PartnerQuotationShare.findOne({
    where: { quotation_id: quotationId, partner_id: partnerId, revoked_at: null } as never
  });
  if (existing) {
    await existing.update({ note } as never);
    return;
  }

  await db.PartnerQuotationShare.create({
    quotation_id: quotationId,
    partner_id: partnerId,
    shared_by: sharedByUserId,
    shared_at: new Date(),
    note
  } as never);
}

/** Withdraw access. The row is kept, with revoked_at set — never deleted. */
export async function revokeQuotationShare(quotationId: string, partnerId: string, revokedByUserId: string): Promise<boolean> {
  if (!isUuid(quotationId) || !isUuid(partnerId)) return false;
  const [count] = await db.PartnerQuotationShare.update(
    { revoked_at: new Date(), revoked_by: revokedByUserId } as never,
    { where: { quotation_id: quotationId, partner_id: partnerId, revoked_at: null } as never }
  );
  return count > 0;
}

/**
 * The one partner this quotation may be shared with, if any.
 *
 * Derived from the quotation's project rather than offered as a free choice,
 * because shareQuotationWithPartner refuses any other partner anyway — a
 * dropdown of every partner would mostly contain options that 400. A
 * quotation on a direct (non-partner) project returns null, and the UI then
 * shows no share control at all.
 */
export async function eligiblePartnerForQuotation(
  quotationId: string
): Promise<{ id: string; company_name: string; partner_code: string } | null> {
  if (!isUuid(quotationId)) return null;
  const quotation = await db.Quotation.findByPk(quotationId, { attributes: ['id', 'project_id'] });
  const projectId = quotation?.get('project_id') as string | null | undefined;
  if (!projectId) return null;

  const project = await db.Project.findByPk(projectId, {
    attributes: ['id', 'partner_id'],
    include: [{ model: db.Partner, as: 'partner', attributes: ['id', 'company_name', 'partner_code'], required: false }]
  });
  const partner = project?.get('partner') as { id?: string; company_name?: string; partner_code?: string } | null | undefined;
  if (!partner?.id) return null;
  return { id: partner.id, company_name: partner.company_name ?? '', partner_code: partner.partner_code ?? '' };
}

/** Is this quotation in a state where it may be shared at all? */
export function isShareableStatus(status: string): boolean {
  return SHAREABLE_STATUSES.includes(status);
}

/** Every live share for a quotation — drives the internal "shared with" display. */
export async function listSharesForQuotation(quotationId: string): Promise<{ partner_id: string; partner_name: string; shared_at: string; note: string }[]> {
  if (!isUuid(quotationId)) return [];
  const rows = await db.PartnerQuotationShare.findAll({
    where: { quotation_id: quotationId, revoked_at: null } as never,
    include: [{ model: db.Partner, as: 'partner', attributes: ['id', 'company_name', 'partner_code'] }]
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const partner = plain.partner as { company_name?: string; partner_code?: string } | null;
    return {
      partner_id: plain.partner_id as string,
      partner_name: partner ? `${partner.company_name} (${partner.partner_code})` : '',
      shared_at: isoOrEmpty(plain.shared_at),
      note: (plain.note as string) ?? ''
    };
  });
}

// markup_percent is deliberately absent — it is this company's margin, and a
// channel partner holding our cost structure is the one disclosure this
// module exists to prevent. prepared_by_user_id is absent for the same
// reason internal ids always are.
const quotationAttributes = [
  'id',
  'quotation_number',
  'revision_number',
  'status',
  'created_at',
  'validity_days',
  'total',
  'subtotal',
  'gst_amount',
  'discount_total',
  'client_name',
  'client_company',
  'project_vertical',
  'project_id',
  'products_json',
  'proposal_kind',
  // The rest of what the customer-facing PDF prints. All of it already
  // appears on the document the customer was given, so none of it is new
  // disclosure — the partner is the one handing that document over.
  'prepared_by',
  'prepared_by_phone',
  'prepared_by_email',
  'client_email',
  'client_phone',
  'client_address',
  'freight_included',
  'installation_included',
  'delivery_period',
  'warranty_terms'
];

/** Everything the client-side PDF generator needs, and nothing else. */
export interface PartnerQuotationPdfPayload {
  quotationNumber: string;
  preparedBy: string;
  preparedByPhone: string;
  preparedByEmail: string;
  clientCompany: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  projectVertical: string;
  validityDays: number;
  freightIncluded: boolean;
  installationIncluded: boolean;
  deliveryPeriod: string;
  warrantyTerms: string;
  // Already flattened into the exact shape generateQuotationPdf wants.
  //
  // Done here rather than in the browser so the raw products_json snapshot
  // never leaves the server, and so the parse happens where the data shape is
  // actually known — Sequelize hands back parsed JSONB, while the internal
  // QuotationRecord carries a stringified copy, and a client helper written
  // for one silently produced zero line items when given the other.
  lineItems: LineItem[];
  productGroups: ProductGroup[];
  totals: {
    subtotal: number;
    // Always 0. The generator's Totals type requires the field, but lib/pdf.ts
    // never prints it (verified), and sending the real percentage would hand
    // over our margin.
    markup: number;
    discountTotal: number;
    preGstTotal: number;
    gstAmount: number;
    total: number;
  };
}

function toPdfPayload(quotation: Record<string, unknown>): PartnerQuotationPdfPayload {
  const n = (v: unknown) => Number(v) || 0;
  return {
    quotationNumber: (quotation.quotation_number as string) ?? '',
    preparedBy: (quotation.prepared_by as string) ?? '',
    preparedByPhone: (quotation.prepared_by_phone as string) ?? '',
    preparedByEmail: (quotation.prepared_by_email as string) ?? '',
    clientCompany: (quotation.client_company as string) ?? '',
    clientName: (quotation.client_name as string) ?? '',
    clientEmail: (quotation.client_email as string) ?? '',
    clientPhone: (quotation.client_phone as string) ?? '',
    clientAddress: (quotation.client_address as string) ?? '',
    projectVertical: (quotation.project_vertical as string) ?? '',
    validityDays: n(quotation.validity_days),
    freightIncluded: quotation.freight_included === true,
    installationIncluded: quotation.installation_included === true,
    deliveryPeriod: (quotation.delivery_period as string) ?? '',
    warrantyTerms: (quotation.warranty_terms as string) ?? '',
    ...flattenStoredProductGroups(parseStoredProductGroups(quotation.products_json)),
    totals: {
      subtotal: n(quotation.subtotal),
      markup: 0,
      discountTotal: n(quotation.discount_total),
      preGstTotal: n(quotation.total) - n(quotation.gst_amount),
      gstAmount: n(quotation.gst_amount),
      total: n(quotation.total)
    }
  };
}

/** Everything currently shared with this partner, newest first. */
export async function listPartnerQuotations(partnerId: string): Promise<PartnerSharedQuotation[]> {
  if (!isUuid(partnerId)) return [];
  const rows = await db.PartnerQuotationShare.findAll({
    // partner_id in the WHERE, and the join restricted to live shares —
    // a revoked share must disappear from the partner's list entirely.
    where: { partner_id: partnerId, revoked_at: null } as never,
    include: [{ model: db.Quotation, as: 'quotation', attributes: quotationAttributes, required: true }],
    order: [['shared_at', 'DESC']]
  });

  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const quotation = plain.quotation as Record<string, unknown>;
    return toPartnerQuotation(
      { ...quotation, created_at: isoOrEmpty(quotation.createdAt) } as unknown as QuotationRecord,
      { shared_at: isoOrEmpty(plain.shared_at), note: (plain.note as string) ?? '' }
    );
  });
}

/**
 * One shared quotation, with its line items.
 *
 * Returns undefined — not an error — when the quotation exists but is not
 * shared with this partner, so the route can 404 without confirming the id
 * is real.
 */
export async function findPartnerQuotation(
  partnerId: string,
  quotationId: string
): Promise<
  | (PartnerSharedQuotation & {
      line_items: { description: string; qty: string; unit: string; rate: number; amount: number }[];
      /** Null for a proposal-kind quotation, which has no generated PDF. */
      pdf: PartnerQuotationPdfPayload | null;
      is_proposal: boolean;
    })
  | undefined
> {
  if (!isUuid(partnerId) || !isUuid(quotationId)) return undefined;
  const row = await db.PartnerQuotationShare.findOne({
    where: { partner_id: partnerId, quotation_id: quotationId, revoked_at: null } as never,
    include: [{ model: db.Quotation, as: 'quotation', attributes: quotationAttributes, required: true }]
  });
  if (!row) return undefined;

  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const quotation = plain.quotation as Record<string, unknown>;
  const base = toPartnerQuotation(
    { ...quotation, created_at: isoOrEmpty(quotation.createdAt) } as unknown as QuotationRecord,
    { shared_at: isoOrEmpty(plain.shared_at), note: (plain.note as string) ?? '' }
  );

  // A 'project'/'tender' proposal is an UPLOADED document, not a generated
  // one — its file lives at an internal upload path the partner cannot read
  // (lib/partnerUploads.ts), so there is nothing to offer here. Flagged so
  // the portal can say so rather than showing a button that does nothing.
  const isProposal = quotation.proposal_kind === 'project' || quotation.proposal_kind === 'tender';

  return {
    ...base,
    line_items: extractLineItems(quotation.products_json),
    is_proposal: isProposal,
    pdf: isProposal ? null : toPdfPayload(quotation)
  };
}

/**
 * Pull the customer-facing line items out of the cached products snapshot.
 *
 * Only description/qty/unit/rate/amount are taken — the stored cart carries
 * internal scaffolding (domain keys, per-item remarks a sales person wrote
 * for themselves, summary entries) that is not part of the quotation the
 * customer was given.
 */
function extractLineItems(productsJson: unknown): { description: string; qty: string; unit: string; rate: number; amount: number }[] {
  if (!Array.isArray(productsJson)) return [];
  const items: { description: string; qty: string; unit: string; rate: number; amount: number }[] = [];
  for (const entry of productsJson as Record<string, unknown>[]) {
    const lineItems = entry?.lineItems;
    if (!Array.isArray(lineItems)) continue;
    for (const li of lineItems as Record<string, unknown>[]) {
      items.push({
        description: String(li.description ?? ''),
        qty: String(li.qty ?? ''),
        unit: String(li.unit ?? ''),
        rate: Number(li.rate) || 0,
        amount: Number(li.amount) || 0
      });
    }
  }
  return items;
}

/** Is this specific quotation live-shared with this partner? Used by the PDF route. */
export async function isQuotationSharedWithPartner(partnerId: string, quotationId: string): Promise<boolean> {
  if (!isUuid(partnerId) || !isUuid(quotationId)) return false;
  const count = await db.PartnerQuotationShare.count({
    where: { partner_id: partnerId, quotation_id: quotationId, revoked_at: null } as never
  });
  return count > 0;
}

export function toPlainShare(row: Model): Record<string, unknown> {
  return row.get({ plain: true }) as Record<string, unknown>;
}
