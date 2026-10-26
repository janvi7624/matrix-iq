import { describe, it, expect } from 'vitest';
import {
  PARTNER_QUOTATION_REQUEST_LABEL,
  QUOTATION_REQUEST_STATUSES,
  QUOTATION_REQUEST_STATUS_LABEL,
  canTransition,
  isOpenRequest,
  isQuotationRequestStatus,
  isQuotationRequestUrgency,
  partnerProgressPercent,
  requiresQuotation,
  requiresResponseNote
} from '../../lib/partnerQuotationRequestStages';

// This module is the only authority on the workflow — the column is a plain
// STRING, so nothing in the database stops an illegal value. Everything that
// writes goes through canTransition, which makes these tests the real
// guardrail.

describe('status vocabulary', () => {
  it('recognises exactly the four workflow values', () => {
    expect([...QUOTATION_REQUEST_STATUSES]).toEqual(['open', 'in_progress', 'quoted', 'declined']);
    for (const status of QUOTATION_REQUEST_STATUSES) {
      expect(isQuotationRequestStatus(status)).toBe(true);
    }
  });

  it('rejects anything else, including values borrowed from other modules', () => {
    // 'draft'/'sent'/'approved' belong to quotations, 'submitted' to partner
    // projects. A copy-paste from either would otherwise write silently.
    for (const bogus of ['draft', 'sent', 'approved', 'rejected', 'submitted', 'closed', '', 'OPEN']) {
      expect(isQuotationRequestStatus(bogus)).toBe(false);
    }
  });

  it('labels every status for both audiences', () => {
    for (const status of QUOTATION_REQUEST_STATUSES) {
      expect(QUOTATION_REQUEST_STATUS_LABEL[status]).toBeTruthy();
      expect(PARTNER_QUOTATION_REQUEST_LABEL[status]).toBeTruthy();
    }
  });

  it('does not show the partner our internal queue wording', () => {
    // 'open' is a queue state of ours; to the person who asked it means
    // "we got it".
    expect(QUOTATION_REQUEST_STATUS_LABEL.open).toBe('New request');
    expect(PARTNER_QUOTATION_REQUEST_LABEL.open).toBe('Received');
  });
});

describe('canTransition', () => {
  it('lets a new request be started, quoted, or declined', () => {
    expect(canTransition('open', 'in_progress')).toBe(true);
    expect(canTransition('open', 'quoted')).toBe(true);
    expect(canTransition('open', 'declined')).toBe(true);
  });

  it('treats quoted as terminal', () => {
    // The thing the request asked for now exists. Any further change belongs
    // to the quotation's own lifecycle; re-opening would leave two records
    // claiming to own the same conversation.
    for (const to of QUOTATION_REQUEST_STATUSES) {
      expect(canTransition('quoted', to)).toBe(false);
    }
  });

  it('lets a declined request be revived rather than duplicated', () => {
    // A customer coming back with a real budget is ordinary. Forcing a new
    // request would lose the history of the first ask.
    expect(canTransition('declined', 'open')).toBe(true);
    expect(canTransition('declined', 'in_progress')).toBe(true);
  });

  it('refuses a transition from an unknown current status', () => {
    // Fails closed: a row holding a value this module does not know about
    // must not be movable, since nothing would be validating the move.
    expect(canTransition('', 'quoted')).toBe(false);
    expect(canTransition('draft', 'quoted')).toBe(false);
  });

  it('never allows a no-op that would restamp handled_at', () => {
    expect(canTransition('open', 'open')).toBe(false);
    expect(canTransition('in_progress', 'in_progress')).toBe(false);
  });
});

describe('what a transition demands', () => {
  it('requires a reason before declining, because the partner reads it', () => {
    expect(requiresResponseNote('declined')).toBe(true);
    for (const to of ['open', 'in_progress', 'quoted'] as const) {
      expect(requiresResponseNote(to)).toBe(false);
    }
  });

  it('requires a linked quotation before marking quoted', () => {
    // Otherwise "quoted" is a claim with nothing behind it, and the portal
    // would tell the partner their quotation is ready with nothing to open.
    expect(requiresQuotation('quoted')).toBe(true);
    for (const to of ['open', 'in_progress', 'declined'] as const) {
      expect(requiresQuotation(to)).toBe(false);
    }
  });
});

describe('queue and progress', () => {
  it('counts only unfinished requests as open work', () => {
    expect(isOpenRequest('open')).toBe(true);
    expect(isOpenRequest('in_progress')).toBe(true);
    expect(isOpenRequest('quoted')).toBe(false);
    expect(isOpenRequest('declined')).toBe(false);
  });

  it('advances the partner bar and finishes at quoted', () => {
    expect(partnerProgressPercent('open')).toBe(33);
    expect(partnerProgressPercent('in_progress')).toBe(66);
    expect(partnerProgressPercent('quoted')).toBe(100);
  });

  it('gives a declined request no progress rather than a misleading bar', () => {
    expect(partnerProgressPercent('declined')).toBe(0);
    expect(partnerProgressPercent('nonsense')).toBe(0);
  });
});

describe('urgency', () => {
  it('accepts only the three levels the form offers', () => {
    for (const level of ['low', 'medium', 'high']) {
      expect(isQuotationRequestUrgency(level)).toBe(true);
    }
    for (const bogus of ['urgent', 'critical', '', 'HIGH']) {
      expect(isQuotationRequestUrgency(bogus)).toBe(false);
    }
  });
});
