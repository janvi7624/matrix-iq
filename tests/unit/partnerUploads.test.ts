import { describe, it, expect } from 'vitest';
import { isPartnerUploadPath, partnerMayReadUpload, partnerUploadPrefix } from '../../lib/partnerUploads';

// Attachment ownership. /api/uploads/file/[...path] authenticates the
// session but never checked WHO OWNS the file — fine while every session
// belonged to an employee, a cross-tenant leak once partners have sessions.
// These tests pin the rule that closes it.

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('partnerMayReadUpload', () => {
  it('admits a partner to their own prefix', () => {
    expect(partnerMayReadUpload(`${partnerUploadPrefix(A)}misc/acme.ravi/123-abc-quote.pdf`, A)).toBe(true);
  });

  it('refuses another partner’s prefix', () => {
    // The whole point: Partner A must not be able to read Partner B's
    // documents by iterating or guessing a path.
    expect(partnerMayReadUpload(`${partnerUploadPrefix(B)}misc/other.user/123-abc-quote.pdf`, A)).toBe(false);
  });

  it('refuses internal upload paths', () => {
    expect(partnerMayReadUpload('uploads/misc/deepak/123-abc-bill.pdf', A)).toBe(false);
    expect(partnerMayReadUpload('uploads/reimbursement/priya/bill.jpg', A)).toBe(false);
  });

  it('refuses traversal attempts even when the prefix matches', () => {
    // Matching the prefix first and walking out afterwards is the obvious
    // attack on a prefix rule, so '..' is refused outright.
    expect(partnerMayReadUpload(`${partnerUploadPrefix(A)}../${B}/secret.pdf`, A)).toBe(false);
    expect(partnerMayReadUpload(`${partnerUploadPrefix(A)}misc/../../uploads/misc/deepak/bill.pdf`, A)).toBe(false);
  });

  it('refuses a near-miss prefix rather than matching loosely', () => {
    // A partner id that merely starts with another's must not match.
    const prefixLike = `uploads/partner/${A}extra/misc/file.pdf`;
    expect(partnerMayReadUpload(prefixLike, A)).toBe(false);
  });

  it('fails closed on empty input', () => {
    expect(partnerMayReadUpload('', A)).toBe(false);
    expect(partnerMayReadUpload(`${partnerUploadPrefix(A)}file.pdf`, '')).toBe(false);
  });
});

describe('partnerUploadPrefix', () => {
  it('ends with a separator so prefix matching cannot straddle ids', () => {
    expect(partnerUploadPrefix(A).endsWith('/')).toBe(true);
  });

  it('is recognised as a partner path', () => {
    expect(isPartnerUploadPath(partnerUploadPrefix(A))).toBe(true);
    expect(isPartnerUploadPath('uploads/misc/deepak/bill.pdf')).toBe(false);
  });
});
