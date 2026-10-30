import { describe, it, expect } from 'vitest';
import {
  MANAGER_LEAVE_MAX_DAYS_AHEAD,
  canOfferMarkLeave,
  validateManagerLeaveMark
} from '../../lib/dailyReportManagerLeave';

// The department manager's "they weren't here" marking. Pinned because it
// waives an obligation — and sometimes a warning already recorded — on
// somebody else's record, so each guard on it is a rule, not a detail.

const TODAY = '2026-10-30';

describe('validateManagerLeaveMark', () => {
  it('accepts a past date with a reason', () => {
    const result = validateManagerLeaveMark({ reportDate: '2026-10-27', reason: 'On casual leave' }, TODAY);
    expect(result).toEqual({ ok: true, reportDate: '2026-10-27', reason: 'On casual leave', isFuture: false });
  });

  it('accepts today', () => {
    const result = validateManagerLeaveMark({ reportDate: TODAY, reason: 'Out sick' }, TODAY);
    expect(result.ok && result.isFuture).toBe(false);
  });

  // Future dates are the point, not an oversight: a manager usually knows
  // about an absence before the 9pm sweep warns anybody for it.
  it('accepts a future date and flags it as such', () => {
    const result = validateManagerLeaveMark({ reportDate: '2026-11-04', reason: 'Wedding leave' }, TODAY);
    expect(result.ok && result.isFuture).toBe(true);
  });

  it(`refuses more than ${MANAGER_LEAVE_MAX_DAYS_AHEAD} days ahead`, () => {
    // A mistyped year must not excuse somebody indefinitely.
    const result = validateManagerLeaveMark({ reportDate: '2126-10-30', reason: 'Typo year' }, TODAY);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(`${MANAGER_LEAVE_MAX_DAYS_AHEAD} days`);
  });

  it('accepts exactly the boundary and refuses one past it', () => {
    expect(validateManagerLeaveMark({ reportDate: '2027-01-28', reason: 'r' }, TODAY).ok).toBe(true); // +90
    expect(validateManagerLeaveMark({ reportDate: '2027-01-29', reason: 'r' }, TODAY).ok).toBe(false); // +91
  });

  it('requires a reason', () => {
    const result = validateManagerLeaveMark({ reportDate: TODAY, reason: '   ' }, TODAY);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/reason/i);
  });

  it('trims the reason it returns', () => {
    const result = validateManagerLeaveMark({ reportDate: TODAY, reason: '  Out sick  ' }, TODAY);
    expect(result.ok && result.reason).toBe('Out sick');
  });

  it('caps the reason length', () => {
    expect(validateManagerLeaveMark({ reportDate: TODAY, reason: 'x'.repeat(2001) }, TODAY).ok).toBe(false);
    expect(validateManagerLeaveMark({ reportDate: TODAY, reason: 'x'.repeat(2000) }, TODAY).ok).toBe(true);
  });

  it('rejects a malformed date', () => {
    expect(validateManagerLeaveMark({ reportDate: '30-10-2026', reason: 'r' }, TODAY).ok).toBe(false);
    expect(validateManagerLeaveMark({ reportDate: '', reason: 'r' }, TODAY).ok).toBe(false);
  });
});

describe('canOfferMarkLeave', () => {
  it('is offered for a missing report when the viewer manages them', () => {
    expect(canOfferMarkLeave({ leave_status: null, report_id: null }, true)).toBe(true);
  });

  it('is not offered to someone who cannot file for others', () => {
    expect(canOfferMarkLeave({ leave_status: null, report_id: null }, false)).toBe(false);
  });

  // A filed report and "they were away" contradict each other on the same row.
  it('is not offered once a report exists', () => {
    expect(canOfferMarkLeave({ leave_status: null, report_id: 'rep-1' }, true)).toBe(false);
  });

  // A second marking would only collide with the partial unique index.
  it('is not offered when a live claim already covers the date', () => {
    expect(canOfferMarkLeave({ leave_status: 'PENDING', report_id: null }, true)).toBe(false);
    expect(canOfferMarkLeave({ leave_status: 'APPROVED', report_id: null }, true)).toBe(false);
    expect(canOfferMarkLeave({ leave_status: 'approved', report_id: null }, true)).toBe(false);
  });

  // A rejected claim is not live, so the date is in scope again.
  it('is offered again after a rejected claim', () => {
    expect(canOfferMarkLeave({ leave_status: 'REJECTED', report_id: null }, true)).toBe(true);
  });
});
