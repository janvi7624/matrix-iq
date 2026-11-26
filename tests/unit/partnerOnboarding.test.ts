import { describe, it, expect } from 'vitest';
import {
  PARTNER_DOCUMENT_KINDS,
  PartnerDocumentLike,
  approvalCompletesOnboarding,
  isPartnerDocumentKind,
  onboardingHeadline,
  onboardingProgress,
  partnerOnboardingComplete
} from '../../lib/partnerOnboarding';

// A new partner uploads four documents — the Agreement and NDA, plus the
// listing documents GST and PAN — and gets the rest of the portal only once
// the person who created their account has approved every one of them.
//
// The states that matter and are easy to get wrong: a document nobody has
// uploaded is NOT "awaiting review" (there is nothing on the creator's desk),
// and a rejected one is not the same as a missing one (the partner has to
// replace it, and needs to be told why).

const doc = (kind: string, status: string, over: Partial<PartnerDocumentLike> = {}): PartnerDocumentLike => ({
  kind,
  status,
  files: [{ name: 'signed.pdf', path: 'uploads/partner/p1/signed.pdf' }],
  ...over
});

const ALL_APPROVED = PARTNER_DOCUMENT_KINDS.map((k) => doc(k, 'approved'));

describe('PARTNER_DOCUMENT_KINDS', () => {
  it('is the four documents asked for', () => {
    expect([...PARTNER_DOCUMENT_KINDS]).toEqual(['agreement', 'nda', 'gst', 'pan']);
  });

  it('recognises only those kinds', () => {
    expect(isPartnerDocumentKind('nda')).toBe(true);
    expect(isPartnerDocumentKind('gst')).toBe(true);
    expect(isPartnerDocumentKind('pan')).toBe(true);
    // The kind this replaced. Rows carrying it are ignored, not resurrected.
    expect(isPartnerDocumentKind('payment_agreement')).toBe(false);
    expect(isPartnerDocumentKind('passport')).toBe(false);
    expect(isPartnerDocumentKind('')).toBe(false);
  });
});

describe('onboardingProgress', () => {
  it('reports a brand-new partner as nothing started', () => {
    const progress = onboardingProgress([]);
    expect(progress.missing).toEqual(['agreement', 'nda', 'gst', 'pan']);
    expect(progress.awaitingReview).toEqual([]);
    expect(progress.approvedCount).toBe(0);
    expect(progress.allApproved).toBe(false);
  });

  // The distinction that decides whose desk the work is on.
  it('does not treat a never-uploaded document as awaiting review', () => {
    const progress = onboardingProgress([doc('agreement', 'pending')]);
    expect(progress.awaitingReview).toEqual(['agreement']);
    expect(progress.missing).toEqual(['nda', 'gst', 'pan']);
  });

  it('separates rejected from missing, and carries the reason', () => {
    const progress = onboardingProgress([doc('nda', 'rejected', { review_remarks: 'Page 3 unsigned' })]);
    expect(progress.rejected).toEqual(['nda']);
    expect(progress.missing).toEqual(['agreement', 'gst', 'pan']);
    expect(progress.steps.find((s) => s.kind === 'nda')?.remarks).toBe('Page 3 unsigned');
  });

  it('is complete only when every one is approved', () => {
    expect(onboardingProgress(ALL_APPROVED).allApproved).toBe(true);
    expect(onboardingProgress(ALL_APPROVED.slice(0, 3)).allApproved).toBe(false);
  });

  // Three approved and one rejected must not read as nearly done.
  it('is not complete while one is rejected', () => {
    const docs = [doc('agreement', 'approved'), doc('nda', 'approved'), doc('gst', 'approved'), doc('pan', 'rejected')];
    const progress = onboardingProgress(docs);
    expect(progress.allApproved).toBe(false);
    expect(progress.approvedCount).toBe(3);
  });

  it('always reports every kind, in a stable order', () => {
    const progress = onboardingProgress([doc('pan', 'approved')]);
    expect(progress.steps.map((s) => s.kind)).toEqual(['agreement', 'nda', 'gst', 'pan']);
  });

  it('ignores a document kind it does not know', () => {
    const progress = onboardingProgress([doc('passport', 'approved')]);
    expect(progress.approvedCount).toBe(0);
    expect(progress.missing).toHaveLength(4);
  });

  it('treats an unrecognised status as not started', () => {
    expect(onboardingProgress([doc('nda', 'whatever')]).missing).toContain('nda');
  });

  it('counts the files on each step', () => {
    const progress = onboardingProgress([doc('nda', 'pending', { files: [
      { name: 'a.pdf', path: 'p/a.pdf' },
      { name: 'b.pdf', path: 'p/b.pdf' }
    ] })]);
    expect(progress.steps.find((s) => s.kind === 'nda')?.fileCount).toBe(2);
  });
});

describe('partnerOnboardingComplete', () => {
  it('is the stored timestamp, not a recount', () => {
    expect(partnerOnboardingComplete({ onboarded_at: '2026-11-02T10:00:00.000Z' })).toBe(true);
    expect(partnerOnboardingComplete({ onboarded_at: null })).toBe(false);
    expect(partnerOnboardingComplete({ onboarded_at: '' })).toBe(false);
    expect(partnerOnboardingComplete({})).toBe(false);
  });
});

describe('approvalCompletesOnboarding', () => {
  it('is true when the approval was the last one outstanding', () => {
    expect(approvalCompletesOnboarding(ALL_APPROVED)).toBe(true);
  });

  it('is false while anything else is outstanding', () => {
    expect(
      approvalCompletesOnboarding([doc('agreement', 'approved'), doc('nda', 'approved'), doc('gst', 'approved'), doc('pan', 'pending')])
    ).toBe(false);
  });
});

describe('onboardingHeadline', () => {
  it('counts uploads while documents are missing', () => {
    expect(onboardingHeadline(onboardingProgress([doc('agreement', 'pending')]))).toBe(
      '1 of 4 documents uploaded. Upload the rest to activate your account.'
    );
  });

  it('says it is with the account manager once everything is in', () => {
    const docs = PARTNER_DOCUMENT_KINDS.map((k) => doc(k, 'pending'));
    expect(onboardingHeadline(onboardingProgress(docs))).toMatch(/Waiting for your account manager/);
  });

  // A rejection outranks the upload count: replacing it is the next action.
  it('leads with a rejection even when everything has been uploaded', () => {
    const docs = [doc('agreement', 'approved'), doc('nda', 'rejected'), doc('gst', 'approved'), doc('pan', 'approved')];
    expect(onboardingHeadline(onboardingProgress(docs))).toBe('One document needs replacing — see the note below it.');
  });

  it('pluralises multiple rejections', () => {
    const docs = [doc('agreement', 'rejected'), doc('nda', 'rejected'), doc('gst', 'approved'), doc('pan', 'approved')];
    expect(onboardingHeadline(onboardingProgress(docs))).toBe('2 documents need replacing — see the notes below them.');
  });

  it('confirms completion', () => {
    expect(onboardingHeadline(onboardingProgress(ALL_APPROVED))).toMatch(/fully active/);
  });
});
