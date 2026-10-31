import { describe, it, expect } from 'vitest';
import { closedProjectsVisible, isClosedProject } from '../../lib/projectVisibility';
import { closedQuotationsVisible, isClosedQuotation } from '../../lib/quotationVisibility';

// Keeping finished work out of the working lists. Neither module had any tests
// before, which is partly how a 90-day threshold that matched nothing in the
// database survived in both of them.
//
// The failure mode these guard against is a person searching for a deal they
// closed last week and being shown nothing, so every way back IN is pinned
// separately.

describe('isClosedProject', () => {
  it('is won or lost, whatever the stage says', () => {
    expect(isClosedProject({ status: 'won' })).toBe(true);
    expect(isClosedProject({ status: 'lost' })).toBe(true);
  });

  // On-hold is live work that has stalled. Hiding it is how a parked deal gets
  // forgotten completely, which is the opposite of the point.
  it('is not active or on-hold', () => {
    expect(isClosedProject({ status: 'active' })).toBe(false);
    expect(isClosedProject({ status: 'on_hold' })).toBe(false);
  });

  // The old rule required closed_at and silently kept any closed project that
  // lacked one. Status alone cannot fail that way.
  it('needs no timestamp', () => {
    expect(isClosedProject({ status: 'won' })).toBe(true);
  });
});

describe('closedProjectsVisible', () => {
  it('hides them by default', () => {
    expect(closedProjectsVisible({})).toBe(false);
    expect(closedProjectsVisible({ statusFilter: '' })).toBe(false);
    expect(closedProjectsVisible({ statusFilter: '   ' })).toBe(false);
  });

  it('keeps hiding them while narrowed to live work', () => {
    expect(closedProjectsVisible({ statusFilter: 'active' })).toBe(false);
    expect(closedProjectsVisible({ statusFilter: 'on_hold' })).toBe(false);
  });

  it('shows them on an explicit Won or Lost pick', () => {
    expect(closedProjectsVisible({ statusFilter: 'won' })).toBe(true);
    expect(closedProjectsVisible({ statusFilter: 'lost' })).toBe(true);
  });

  // The gap the old rule had: a date search omitted everything closed, with no
  // indication it had done so.
  it('shows them whenever a date range is active', () => {
    expect(closedProjectsVisible({ dateFilterActive: true })).toBe(true);
  });

  it('shows them on a date range even while narrowed to a live status', () => {
    expect(closedProjectsVisible({ statusFilter: 'active', dateFilterActive: true })).toBe(true);
  });

  it('shows them when the person asks outright', () => {
    expect(closedProjectsVisible({ userOverride: true })).toBe(true);
  });

  it('does not accept a quotation status as a reveal', () => {
    expect(closedProjectsVisible({ statusFilter: 'approved' })).toBe(false);
  });
});

describe('isClosedQuotation', () => {
  const quote = (over: Partial<Parameters<typeof isClosedQuotation>[0]> = {}) => ({
    status: 'sent',
    // Relative to now, not a fixed date. Expiry is derived from
    // created_at + validity_days against the real clock, so the old pinned
    // '2026-10-01' + 30 days fixture turned into an EXPIRED quote on
    // 31 Oct 2026 — and expired counts as closed, so the "a sent quote is
    // not closed" case started failing on that date and every day after.
    created_at: new Date().toISOString(),
    validity_days: 30,
    status_changed_at: '',
    ...over
  } as Parameters<typeof isClosedQuotation>[0]);

  it('is approved or rejected', () => {
    expect(isClosedQuotation(quote({ status: 'approved' }))).toBe(true);
    expect(isClosedQuotation(quote({ status: 'rejected' }))).toBe(true);
  });

  // A sent quotation is the opposite of closed — it is waiting on the
  // customer, and 40 of 56 live quotations are in exactly that state.
  it('is not draft or sent', () => {
    expect(isClosedQuotation(quote({ status: 'draft' }))).toBe(false);
    expect(isClosedQuotation(quote({ status: 'sent' }))).toBe(false);
  });

  // Expired is derived from created_at + validity_days rather than stored, and
  // it counts as closed: a quote whose validity has run out is as finished as
  // a rejected one. Carried over from the previous rule deliberately.
  it('treats an expired quote as closed — expired counts as rejected', () => {
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(isClosedQuotation(quote({ status: 'sent', created_at: longAgo, validity_days: 7 }))).toBe(true);
  });

  it('does not treat a still-valid sent quote as closed', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isClosedQuotation(quote({ status: 'sent', created_at: yesterday, validity_days: 30 }))).toBe(false);
  });

  // Approved outranks expiry: a quote the customer accepted is won work, not
  // an expired one, however long its validity window was.
  it('reports an approved quote as closed even past its validity', () => {
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(isClosedQuotation(quote({ status: 'approved', created_at: longAgo, validity_days: 7 }))).toBe(true);
  });
});

describe('closedQuotationsVisible', () => {
  it('hides them by default', () => {
    expect(closedQuotationsVisible({})).toBe(false);
  });

  it('keeps hiding them while narrowed to sent', () => {
    expect(closedQuotationsVisible({ statusFilter: 'sent' })).toBe(false);
    expect(closedQuotationsVisible({ statusFilter: 'draft' })).toBe(false);
  });

  it('shows them on an explicit Approved or Rejected pick', () => {
    expect(closedQuotationsVisible({ statusFilter: 'approved' })).toBe(true);
    expect(closedQuotationsVisible({ statusFilter: 'rejected' })).toBe(true);
    expect(closedQuotationsVisible({ statusFilter: 'expired' })).toBe(true);
  });

  it('shows them on any date range, or on request', () => {
    expect(closedQuotationsVisible({ dateFilterActive: true })).toBe(true);
    expect(closedQuotationsVisible({ userOverride: true })).toBe(true);
  });

  it('does not accept a project status as a reveal', () => {
    expect(closedQuotationsVisible({ statusFilter: 'won' })).toBe(false);
  });
});

// The two lists must agree about the shape of the rule, or one of them starts
// surprising people.
describe('the two rules behave the same way', () => {
  it('both hide by default, reveal on a date range, and reveal on request', () => {
    for (const visible of [closedProjectsVisible, closedQuotationsVisible]) {
      expect(visible({})).toBe(false);
      expect(visible({ dateFilterActive: true })).toBe(true);
      expect(visible({ userOverride: true })).toBe(true);
    }
  });
});
