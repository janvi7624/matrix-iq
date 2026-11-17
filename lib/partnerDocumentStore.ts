import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { PartnerDocumentKind, isPartnerDocumentKind } from './partnerOnboarding';

// Reading and writing a partner's onboarding documents. Approval of the set
// (and stamping partners.onboarded_at) lives in lib/partnerApprovalStore.ts.

export class PartnerDocumentError extends Error {}

export interface PartnerDocumentFile {
  name: string;
  path: string;
  size?: number;
}

export interface PartnerDocumentRecord {
  id: string;
  partner_id: string;
  kind: PartnerDocumentKind;
  files: PartnerDocumentFile[];
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  submitted_by_name: string;
  reviewed_by_name: string;
  reviewed_at: string;
  review_remarks: string;
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const INCLUDES = [
  { model: db.User, as: 'submitter', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'reviewer', attributes: ['id', 'username', 'name'] }
];

function toRecord(row: Model): PartnerDocumentRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const submitter = plain.submitter as { name?: string; username?: string } | null;
  const reviewer = plain.reviewer as { name?: string; username?: string } | null;
  return {
    id: plain.id as string,
    partner_id: plain.partner_id as string,
    kind: plain.kind as PartnerDocumentKind,
    files: Array.isArray(plain.files) ? (plain.files as PartnerDocumentFile[]) : [],
    status: (plain.status as PartnerDocumentRecord['status']) ?? 'pending',
    submitted_at: isoOrEmpty(plain.submitted_at),
    submitted_by_name: submitter?.name ?? submitter?.username ?? '',
    reviewed_by_name: reviewer?.name ?? reviewer?.username ?? '',
    reviewed_at: isoOrEmpty(plain.reviewed_at),
    review_remarks: (plain.review_remarks as string) ?? ''
  };
}

export async function listPartnerDocuments(partnerId: string): Promise<PartnerDocumentRecord[]> {
  if (!isUuid(partnerId)) return [];
  const rows = await db.PartnerDocument.findAll({
    where: { partner_id: partnerId } as never,
    include: INCLUDES as never,
    order: [['created_at', 'ASC']]
  });
  return rows.map(toRecord);
}

export interface SubmitDocumentInput {
  partnerId: string;
  kind: string;
  files: PartnerDocumentFile[];
  submittedById: string;
}

/**
 * Upload (or replace) one document — by the partner, or by our staff on the
 * partner's behalf when a signed copy arrived by email.
 *
 * Always lands 'pending': approval is no longer a per-document click but the
 * Sales -> Accounts -> Admin chain over the whole set (lib/partnerApprovalStore.ts),
 * which the caller starts with startApprovalIfReady once this returns.
 *
 * Upserted on (partner, kind) rather than appended: "which agreement is
 * current" must have one answer. Re-uploading after a rejection reuses the
 * row and clears the previous reviewer and remark.
 */
export async function submitPartnerDocument(input: SubmitDocumentInput): Promise<PartnerDocumentRecord> {
  if (!isUuid(input.partnerId)) throw new PartnerDocumentError('Unknown partner.');
  if (!isPartnerDocumentKind(input.kind)) throw new PartnerDocumentError('Unknown document type.');
  const files = (input.files || []).filter((f) => f && typeof f.path === 'string' && f.path.trim());
  if (!files.length) throw new PartnerDocumentError('Attach the signed document before submitting.');

  // findOne + create, never findOrCreate — the DB role has no TEMP
  // privilege, which findOrCreate needs.
  const existing = await db.PartnerDocument.findOne({
    where: { partner_id: input.partnerId, kind: input.kind } as never
  });

  const attrs = {
    files,
    status: 'pending',
    submitted_at: new Date(),
    submitted_by: input.submittedById,
    reviewed_by: null,
    reviewed_at: null,
    review_remarks: null
  };

  if (existing) {
    await existing.update(attrs as never);
  } else {
    await db.PartnerDocument.create({ partner_id: input.partnerId, kind: input.kind, ...attrs } as never);
  }

  const row = await db.PartnerDocument.findOne({
    where: { partner_id: input.partnerId, kind: input.kind } as never,
    include: INCLUDES as never
  });
  return toRecord(row as Model);
}
