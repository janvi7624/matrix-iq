import { describe, it, expect } from 'vitest';
import {
  applyPaymentFilters,
  collectFacets,
  isOverdue,
  periodBounds,
  summariseFiltered
} from '../../lib/paymentFilters';
import { PaymentQueueItem } from '../../lib/types';

const NOW = new Date('2026-09-15T12:00:00.000Z');

function item(overrides: Partial<PaymentQueueItem> = {}): PaymentQueueItem {
  return {
    paymentId: 'reimbursement_sheet:1',
    source: 'reimbursement_sheet',
    sourceId: '1',
    sourceLabel: 'Reimbursement',
    payee: 'Asha R',
    description: 'Reimbursement — August 2026',
    amount: 10000,
    department: 'Sales',
    requestedBy: 'Asha R',
    approvedBy: 'Khushi',
    approvedAt: '2026-09-01T00:00:00.000Z',
    dueDate: '2026-09-20T00:00:00.000Z',
    status: 'payment_required',
    paidAt: null,
    paidBy: null,
    paymentMethod: null,
    paymentReference: null,
    holdReason: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides
  };
}

describe('periodBounds', () => {
  it('resolves a fiscal month to a half-open range', () => {
    const bounds = periodBounds({ periodType: 'monthly', fiscalYear: '2026-27', periodKey: '2026-09' });
    expect(bounds?.start).toBe('2026-09-01');
    // Exclusive end — the day AFTER the period, so the last day counts in full.
    expect(bounds?.endExclusive).toBe('2026-10-01');
  });

  it('resolves quarters, halves and the year', () => {
    expect(periodBounds({ periodType: 'quarterly', fiscalYear: '2026-27', periodKey: 'Q2' })).toEqual({
      start: '2026-07-01',
      endExclusive: '2026-10-01'
    });
    expect(periodBounds({ periodType: 'half_yearly', fiscalYear: '2026-27', periodKey: 'H2' })).toEqual({
      start: '2026-10-01',
      endExclusive: '2027-04-01'
    });
    expect(periodBounds({ periodType: 'annual', fiscalYear: '2026-27', periodKey: '' })).toEqual({
      start: '2026-04-01',
      endExclusive: '2027-04-01'
    });
  });

  it('returns null — "do not filter" — for a malformed period', () => {
    // A hand-edited URL must not silently produce an empty list, which is
    // indistinguishable from "there is nothing to pay".
    expect(periodBounds({ periodType: 'monthly', fiscalYear: '2026-27', periodKey: 'nonsense' })).toBeNull();
    expect(periodBounds(null)).toBeNull();
  });
});

describe('applyPaymentFilters — period', () => {
  const items = [
    item({ paymentId: 'a', createdAt: '2026-09-01T10:00:00.000Z' }),
    item({ paymentId: 'b', createdAt: '2026-09-30T23:30:00.000Z' }),
    item({ paymentId: 'c', createdAt: '2026-10-01T00:30:00.000Z' }),
    item({ paymentId: 'd', createdAt: '2026-08-31T23:00:00.000Z' })
  ];

  it('includes the whole last day of the period', () => {
    // The classic off-by-one: comparing against the bare end date drops
    // everything timestamped after midnight on the final day.
    const result = applyPaymentFilters(items, {
      period: { periodType: 'monthly', fiscalYear: '2026-27', periodKey: '2026-09' }
    });
    expect(result.map((i) => i.paymentId)).toEqual(['a', 'b']);
  });

  it('measures history against the PAID date, not the created date', () => {
    // "Paid in September" and "raised in September" are different questions.
    const paid = [
      item({ paymentId: 'x', status: 'paid', createdAt: '2026-08-01T00:00:00.000Z', paidAt: '2026-09-10T00:00:00.000Z' }),
      item({ paymentId: 'y', status: 'paid', createdAt: '2026-09-01T00:00:00.000Z', paidAt: '2026-10-10T00:00:00.000Z' })
    ];
    const result = applyPaymentFilters(paid, {
      period: { periodType: 'monthly', fiscalYear: '2026-27', periodKey: '2026-09' },
      dateBasis: 'paidAt'
    });
    expect(result.map((i) => i.paymentId)).toEqual(['x']);
  });

  it('drops an item with no date on the chosen basis', () => {
    const unpaid = [item({ paymentId: 'u', paidAt: null })];
    expect(applyPaymentFilters(unpaid, {
      period: { periodType: 'annual', fiscalYear: '2026-27', periodKey: '' },
      dateBasis: 'paidAt'
    })).toEqual([]);
  });

  it('spans the calendar-year boundary for Q4', () => {
    const q4 = [
      item({ paymentId: 'jan', createdAt: '2027-01-15T00:00:00.000Z' }),
      item({ paymentId: 'apr', createdAt: '2027-04-15T00:00:00.000Z' })
    ];
    const result = applyPaymentFilters(q4, {
      period: { periodType: 'quarterly', fiscalYear: '2026-27', periodKey: 'Q4' }
    });
    expect(result.map((i) => i.paymentId)).toEqual(['jan']);
  });
});

describe('applyPaymentFilters — custom dates', () => {
  it('treats the "to" date as the end of that day', () => {
    // Picking the same day for from and to must match that day, not nothing.
    const items = [item({ paymentId: 'a', createdAt: '2026-09-01T18:00:00.000Z' })];
    const result = applyPaymentFilters(items, { dateFrom: '2026-09-01', dateTo: '2026-09-01' });
    expect(result).toHaveLength(1);
  });

  it('is ignored when a period is also given, rather than intersecting', () => {
    const items = [item({ paymentId: 'a', createdAt: '2026-09-15T00:00:00.000Z' })];
    const result = applyPaymentFilters(items, {
      period: { periodType: 'monthly', fiscalYear: '2026-27', periodKey: '2026-09' },
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31'
    });
    // The period wins; the stale custom range doesn't silently empty it.
    expect(result).toHaveLength(1);
  });
});

describe('applyPaymentFilters — department and employee', () => {
  const items = [
    item({ paymentId: 'a', department: 'Sales', payee: 'Asha R', requestedBy: 'Asha R' }),
    item({ paymentId: 'b', department: 'Accounts', payee: 'Vikram S', requestedBy: 'Vikram S' }),
    // Payee and requester differ — a BOM request raised for someone else.
    item({ paymentId: 'c', department: 'Sales', payee: 'Acme Supplies', requestedBy: 'Asha R' })
  ];

  it('filters by department exactly, not by substring', () => {
    expect(applyPaymentFilters(items, { department: 'Sales' }).map((i) => i.paymentId)).toEqual(['a', 'c']);
  });

  it('ignores case and stray spacing in the department', () => {
    expect(applyPaymentFilters(items, { department: '  sales ' }).map((i) => i.paymentId)).toEqual(['a', 'c']);
  });

  it('matches an employee as payee OR requester', () => {
    // Asha is the payee on 'a' and only the requester on 'c' — both are
    // "to do with Asha", which is what filtering by a person means.
    expect(applyPaymentFilters(items, { employee: 'Asha R' }).map((i) => i.paymentId)).toEqual(['a', 'c']);
  });

  it('combines department and employee as AND', () => {
    expect(applyPaymentFilters(items, { department: 'Accounts', employee: 'Asha R' })).toEqual([]);
  });
});

describe('applyPaymentFilters — amount, source, status, search', () => {
  const items = [
    item({ paymentId: 'a', amount: 500 }),
    item({ paymentId: 'b', amount: 5000 }),
    item({ paymentId: 'c', amount: 50000, source: 'bom_request', sourceLabel: 'BOM Request', status: 'on_hold' })
  ];

  it('filters an amount range inclusively', () => {
    expect(applyPaymentFilters(items, { minAmount: 500, maxAmount: 5000 }).map((i) => i.paymentId)).toEqual(['a', 'b']);
  });

  it('allows an open-ended minimum', () => {
    expect(applyPaymentFilters(items, { minAmount: 5000 }).map((i) => i.paymentId)).toEqual(['b', 'c']);
  });

  it('filters by source and status', () => {
    expect(applyPaymentFilters(items, { source: 'bom_request' }).map((i) => i.paymentId)).toEqual(['c']);
    expect(applyPaymentFilters(items, { status: 'on_hold' }).map((i) => i.paymentId)).toEqual(['c']);
  });

  it('treats "all" as no filter', () => {
    expect(applyPaymentFilters(items, { source: 'all', status: 'all' })).toHaveLength(3);
  });

  it('searches across id, payee, description, requester and reference', () => {
    const withRef = [item({ paymentId: 'r', paymentReference: 'NEFT-99812' })];
    expect(applyPaymentFilters(withRef, { search: 'neft-998' })).toHaveLength(1);
    expect(applyPaymentFilters(withRef, { search: 'asha' })).toHaveLength(1);
    expect(applyPaymentFilters(withRef, { search: 'nothing here' })).toHaveLength(0);
  });
});

describe('overdue', () => {
  it('is only ever true for an unpaid item past its due date', () => {
    expect(isOverdue(item({ dueDate: '2026-09-01T00:00:00.000Z' }), NOW)).toBe(true);
    expect(isOverdue(item({ dueDate: '2026-09-30T00:00:00.000Z' }), NOW)).toBe(false);
    // Already paid, however late — not outstanding.
    expect(isOverdue(item({ dueDate: '2026-09-01T00:00:00.000Z', status: 'paid' }), NOW)).toBe(false);
    // No due date means no SLA to breach.
    expect(isOverdue(item({ dueDate: null }), NOW)).toBe(false);
  });

  it('filters the queue down to what is late', () => {
    const items = [
      item({ paymentId: 'late', dueDate: '2026-09-01T00:00:00.000Z' }),
      item({ paymentId: 'soon', dueDate: '2026-09-30T00:00:00.000Z' })
    ];
    expect(applyPaymentFilters(items, { overdueOnly: true }, NOW).map((i) => i.paymentId)).toEqual(['late']);
  });
});

describe('collectFacets', () => {
  it('lists departments and people actually present, A-Z and deduped', () => {
    const items = [
      item({ department: 'Sales', payee: 'Asha R', requestedBy: 'Asha R' }),
      item({ department: 'Accounts', payee: 'Vikram S', requestedBy: 'Khushi' }),
      item({ department: 'Sales', payee: 'Acme Supplies', requestedBy: 'Asha R' })
    ];
    const facets = collectFacets(items);
    expect(facets.departments).toEqual(['Accounts', 'Sales']);
    expect(facets.employees).toEqual(['Acme Supplies', 'Asha R', 'Khushi', 'Vikram S']);
  });

  it('skips blanks rather than offering an empty option', () => {
    const facets = collectFacets([item({ department: '', payee: '  ', requestedBy: '' })]);
    expect(facets.departments).toEqual([]);
    expect(facets.employees).toEqual([]);
  });
});

describe('summariseFiltered', () => {
  it('totals what the current filter adds up to', () => {
    const items = [
      item({ amount: 10000, dueDate: '2026-09-01T00:00:00.000Z' }),
      item({ amount: 2500, dueDate: '2026-09-30T00:00:00.000Z' })
    ];
    expect(summariseFiltered(items, NOW)).toEqual({
      count: 2,
      amount: 12500,
      overdueCount: 1,
      overdueAmount: 10000
    });
  });

  it('is all zeroes for an empty result', () => {
    expect(summariseFiltered([], NOW)).toEqual({ count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 });
  });
});
