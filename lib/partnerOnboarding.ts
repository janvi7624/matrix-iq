// Partner onboarding: which documents a new partner owes, where they are up
// to, and whether they may use the rest of the portal yet.
//
// A partner account is created by a member of the sales team, who is then
// the person that approves what the partner uploads. Until every
// documents are approved the partner can sign in but reaches only the
// onboarding page — the portal is not refused at the door (they would have
// no way to comply) and not opened either.
//
// Pure: no db/fs imports, so the gate, the progress strip and the tests all
// read the same rules.

export const PARTNER_DOCUMENT_KINDS = ['agreement', 'nda', 'gst', 'pan'] as const;

export type PartnerDocumentKind = (typeof PARTNER_DOCUMENT_KINDS)[number];

export type PartnerDocumentStatus = 'pending' | 'approved' | 'rejected';

export const PARTNER_DOCUMENT_LABEL: Record<PartnerDocumentKind, string> = {
  agreement: 'Partnership Agreement',
  nda: 'Non-Disclosure Agreement (NDA)',
  gst: 'GST',
  pan: 'PAN No.'
};

/**
 * The heading each document is listed under.
 *
 * Two groups, because they are asked for two different reasons: the
 * agreement and NDA are the terms of the relationship, while GST and PAN are
 * what the company needs on file to list the partner as a payable vendor at
 * all. Every document in both groups is mandatory — onboarding completes only
 * when all four are approved — so the grouping is for legibility, not for
 * optional extras.
 */
export const PARTNER_DOCUMENT_GROUPS: { title: string; kinds: PartnerDocumentKind[] }[] = [
  { title: 'Onboarding documents', kinds: ['agreement', 'nda'] },
  { title: 'Listing documents', kinds: ['gst', 'pan'] }
];

/** What the partner is told to provide, in the order they are asked for it. */
export const PARTNER_DOCUMENT_HINT: Record<PartnerDocumentKind, string> = {
  agreement: 'The signed partnership agreement, as a PDF or scan.',
  nda: 'The signed NDA. Every page, signed and dated by both sides.',
  gst: 'Your GST registration certificate. Required.',
  pan: 'Your company PAN card. Required.'
};

export function isPartnerDocumentKind(value: string): value is PartnerDocumentKind {
  return (PARTNER_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export interface PartnerDocumentLike {
  kind: string;
  status: string;
  files?: { name: string; path: string; size?: number }[];
  review_remarks?: string;
}

export interface OnboardingProgress {
  /** Every kind, with its current state — absent kinds read as 'not_started'. */
  steps: {
    kind: PartnerDocumentKind;
    label: string;
    state: 'not_started' | PartnerDocumentStatus;
    remarks: string;
    fileCount: number;
  }[];
  /** Kinds with nothing uploaded yet. */
  missing: PartnerDocumentKind[];
  /** Uploaded and waiting on the account creator. */
  awaitingReview: PartnerDocumentKind[];
  /** Rejected — the partner has to replace these. */
  rejected: PartnerDocumentKind[];
  approvedCount: number;
  /** True only when every required document is approved. */
  allApproved: boolean;
}

/**
 * Where this partner is up to.
 *
 * A kind with no row at all is 'not_started' rather than 'pending': nothing
 * has been submitted, so there is nothing for the creator to look at, and
 * showing it as awaiting review would put work on the wrong desk.
 */
export function onboardingProgress(documents: PartnerDocumentLike[]): OnboardingProgress {
  const byKind = new Map<string, PartnerDocumentLike>();
  for (const doc of documents) {
    if (isPartnerDocumentKind(doc.kind)) byKind.set(doc.kind, doc);
  }

  const steps = PARTNER_DOCUMENT_KINDS.map((kind) => {
    const doc = byKind.get(kind);
    const status = doc?.status;
    const state: 'not_started' | PartnerDocumentStatus =
      status === 'approved' || status === 'rejected' || status === 'pending' ? status : 'not_started';
    return {
      kind,
      label: PARTNER_DOCUMENT_LABEL[kind],
      state,
      remarks: doc?.review_remarks ?? '',
      fileCount: doc?.files?.length ?? 0
    };
  });

  return {
    steps,
    missing: steps.filter((s) => s.state === 'not_started').map((s) => s.kind),
    awaitingReview: steps.filter((s) => s.state === 'pending').map((s) => s.kind),
    rejected: steps.filter((s) => s.state === 'rejected').map((s) => s.kind),
    approvedCount: steps.filter((s) => s.state === 'approved').length,
    allApproved: steps.every((s) => s.state === 'approved')
  };
}

/**
 * May this partner use the portal beyond the onboarding page?
 *
 * Keyed on the stored onboarded_at rather than recomputed from the documents
 * every request: it is one timestamp instead of a join, it survives a
 * document being revised later (an approved partner does not lose access
 * because somebody re-uploaded an agreement), and it is what let existing
 * partners be grandfathered in the migration.
 */
export function partnerOnboardingComplete(partner: { onboarded_at?: string | null }): boolean {
  return !!partner.onboarded_at;
}

/** The one line the partner sees at the top of the onboarding page. */
export function onboardingHeadline(progress: OnboardingProgress): string {
  if (progress.allApproved) return 'All documents approved — your account is fully active.';
  if (progress.rejected.length) {
    return progress.rejected.length === 1
      ? 'One document needs replacing — see the note below it.'
      : `${progress.rejected.length} documents need replacing — see the notes below them.`;
  }
  if (!progress.missing.length) return 'All documents uploaded. Waiting for your account manager to review them.';
  const done = PARTNER_DOCUMENT_KINDS.length - progress.missing.length;
  return `${done} of ${PARTNER_DOCUMENT_KINDS.length} documents uploaded. Upload the rest to activate your account.`;
}

/**
 * Whether approving this one document completes onboarding.
 *
 * Takes the documents as they will be AFTER the approval, so the caller can
 * stamp onboarded_at in the same transaction rather than re-reading.
 */
export function approvalCompletesOnboarding(documentsAfterApproval: PartnerDocumentLike[]): boolean {
  return onboardingProgress(documentsAfterApproval).allApproved;
}
