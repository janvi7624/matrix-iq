import { Model } from 'sequelize';
import { db, isUuid } from './db';
import {
  PartnerDocumentKind,
  approvalCompletesOnboarding,
  isPartnerDocumentKind
} from './partnerOnboarding';

// Reading and writing a partner's onboarding documents, and the one
// side-effect that matters: approving the last outstanding document stamps
// partners.onboarded_at, which is what opens the rest of the portal.

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
  /**
   * Set when a member of staff is uploading on the partner's behalf AND may
   * approve this partner's documents — a signed agreement that arrived by
   * email, say, rather than through the portal.
   *
   * It lands approved rather than pending because the person uploading is
   * the same person who would approve it: asking them to click Approve on a
   * file they just provided is theatre, not a control. The record still
   * shows both facts — submitted_by and reviewed_by are both them, and the
   * remark says it was provided by staff, so nobody later mistakes it for
   * something the partner sent.
   *
   * Never set for an upload that came from the partner's own session.
   */
  approvedByUploader?: boolean;
}

/**
 * The partner uploads (or replaces) one document.
 *
 * Upserted on (partner, kind) rather than appended: "which agreement is
 * current" must have one answer. Re-uploading after a rejection reuses the
 * row and resets it to 'pending', which also clears the previous reviewer
 * and remark — leaving the old rejection note attached to a freshly uploaded
 * file would read as though the new one had already been refused.
 *
 * Replacing an APPROVED document is allowed and sends it back for review.
 * That does not revoke access: onboarded_at is already stamped and stays
 * stamped (see partnerOnboardingComplete), so a partner updating a document
 * a year later does not lose the portal mid-session.
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

  const now = new Date();
  const staffProvided = !!input.approvedByUploader;
  const attrs = staffProvided
    ? {
        files,
        status: 'approved',
        submitted_at: now,
        submitted_by: input.submittedById,
        reviewed_by: input.submittedById,
        reviewed_at: now,
        review_remarks: 'Provided by our team on the partner’s behalf.'
      }
    : {
        files,
        status: 'pending',
        submitted_at: now,
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

  // A staff upload can be the thing that completes onboarding, so the gate
  // is stamped here too — otherwise a partner whose three documents were all
  // supplied by our own team would stay locked out of the portal with
  // nothing left for anyone to approve.
  if (staffProvided) await stampOnboardedIfComplete(input.partnerId);

  const row = await db.PartnerDocument.findOne({
    where: { partner_id: input.partnerId, kind: input.kind } as never,
    include: INCLUDES as never
  });
  return toRecord(row as Model);
}

/**
 * Sets partners.onboarded_at when every required document is approved.
 *
 * Shared by the two paths that can complete onboarding — a reviewer
 * approving the last one, and staff uploading the last one themselves — so
 * the gate cannot be opened by one and missed by the other. Stamped once
 * only: a document replaced and re-approved later keeps the original date.
 */
async function stampOnboardedIfComplete(partnerId: string): Promise<boolean> {
  const all = await db.PartnerDocument.findAll({
    where: { partner_id: partnerId } as never,
    attributes: ['kind', 'status']
  });
  const after = all.map((r) => ({ kind: r.get('kind') as string, status: r.get('status') as string }));
  if (!approvalCompletesOnboarding(after)) return false;

  const partner = await db.Partner.findByPk(partnerId);
  if (!partner || partner.get('onboarded_at')) return false;
  await partner.update({ onboarded_at: new Date() } as never);
  return true;
}

export interface ReviewDocumentResult {
  document: PartnerDocumentRecord;
  /** True when this approval was the last one outstanding. */
  onboardingCompleted: boolean;
}

/**
 * The account creator approves or rejects one document.
 *
 * A rejection REQUIRES a remark. The partner's only way to know what to fix
 * is this sentence, and a silent rejection would have them re-uploading the
 * same file.
 *
 * Approving the last outstanding document stamps partners.onboarded_at in
 * the same transaction as the approval — the gate and the evidence for it
 * cannot end up disagreeing because one write landed and the other did not.
 */
export async function reviewPartnerDocument(
  partnerId: string,
  kind: string,
  decision: 'approved' | 'rejected',
  reviewerId: string,
  remarks: string
): Promise<ReviewDocumentResult> {
  if (!isUuid(partnerId)) throw new PartnerDocumentError('Unknown partner.');
  if (!isPartnerDocumentKind(kind)) throw new PartnerDocumentError('Unknown document type.');
  const note = (remarks || '').trim();
  if (decision === 'rejected' && !note) {
    throw new PartnerDocumentError('Say what needs correcting — the partner sees this.');
  }
  if (note.length > 2000) throw new PartnerDocumentError('Keep the note under 2000 characters.');

  const row = await db.PartnerDocument.findOne({ where: { partner_id: partnerId, kind } as never });
  if (!row) throw new PartnerDocumentError('That document has not been uploaded yet.');
  const from = row.get('status') as string;
  if (from === decision) {
    throw new PartnerDocumentError(`This document is already ${decision}.`);
  }

  let onboardingCompleted = false;

  await db.sequelize.transaction(async (t) => {
    // Re-checked against the same `from` read above: without this WHERE,
    // two reviewers deciding the same document at once (one approving, one
    // rejecting) would both pass the stale-status check and both write —
    // the second silently overwrites the first's decision instead of
    // failing.
    const [affected] = await db.PartnerDocument.update(
      { status: decision, reviewed_by: reviewerId, reviewed_at: new Date(), review_remarks: note || null } as never,
      { where: { partner_id: partnerId, kind, status: from } as never, transaction: t }
    );
    if (!affected) throw new PartnerDocumentError('This document was just reviewed by someone else — refresh and try again.');

    if (decision !== 'approved') return;

    const all = await db.PartnerDocument.findAll({
      where: { partner_id: partnerId } as never,
      attributes: ['kind', 'status'],
      transaction: t
    });
    const after = all.map((r) => ({ kind: r.get('kind') as string, status: r.get('status') as string }));
    if (!approvalCompletesOnboarding(after)) return;

    const partner = await db.Partner.findByPk(partnerId, { transaction: t });
    // Only stamped once. A partner who replaces a document later and has it
    // re-approved keeps their original onboarding date.
    if (partner && !partner.get('onboarded_at')) {
      await partner.update({ onboarded_at: new Date() } as never, { transaction: t });
      onboardingCompleted = true;
    }
  });

  const fresh = await db.PartnerDocument.findOne({
    where: { partner_id: partnerId, kind } as never,
    include: INCLUDES as never
  });
  return { document: toRecord(fresh as Model), onboardingCompleted };
}
