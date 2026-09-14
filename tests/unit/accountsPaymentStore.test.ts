import { describe, it, expect } from 'vitest';
import { sortPaymentQueue, computeSummary, parsePaymentId } from '../../lib/accountsPaymentStore';
import { PaymentQueueItem } from '../../lib/types';

function makeItem(overrides: Partial<PaymentQueueItem>): PaymentQueueItem {
  return {
    paymentId: 'reimbursement_sheet:1',
    source: 'reimbursement_sheet',
    sourceId: '1',
    sourceLabel: 'Reimbursement',
    payee: 'Test Payee',
    description: 'Test',
    amount: 1000,
    department: '',
    requestedBy: 'Test',
    approvedBy: 'Approver',
    approvedAt: null,
    dueDate: null,
    status: 'payment_required',
    paidAt: null,
    paidBy: null,
    paymentMethod: null,
    paymentReference: null,
    holdReason: null,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

describe('parsePaymentId', () => {
  it('splits a composite payment id into source and sourceId', () => {
    expect(parsePaymentId('admin_expense:admin-12345')).toEqual({ source: 'admin_expense', sourceId: 'admin-12345' });
  });

  it('rejects an id with no colon', () => {
    expect(parsePaymentId('no-colon-here')).toBeNull();
  });

  it('rejects an unknown source prefix', () => {
    expect(parsePaymentId('not_a_real_source:123')).toBeNull();
  });

  it('rejects an empty sourceId', () => {
    expect(parsePaymentId('admin_expense:')).toBeNull();
  });
});

describe('sortPaymentQueue', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  it('sorts overdue before due-today before due-soon before no-due-date', () => {
    const noDue = makeItem({ paymentId: 'a', dueDate: null, createdAt: new Date(now - 100 * day).toISOString() });
    const dueSoon = makeItem({ paymentId: 'b', dueDate: new Date(now + 2.5 * day).toISOString() });
    const overdue = makeItem({ paymentId: 'c', dueDate: new Date(now - 5 * day).toISOString() });
    const dueToday = makeItem({ paymentId: 'd', dueDate: new Date(now).toISOString() });

    const sorted = sortPaymentQueue([noDue, dueSoon, overdue, dueToday]);
    expect(sorted.map((i) => i.paymentId)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('sorts oldest-first within the same priority bucket', () => {
    const older = makeItem({ paymentId: 'older', dueDate: null, createdAt: new Date(now - 10 * day).toISOString() });
    const newer = makeItem({ paymentId: 'newer', dueDate: null, createdAt: new Date(now - 1 * day).toISOString() });
    const sorted = sortPaymentQueue([newer, older]);
    expect(sorted.map((i) => i.paymentId)).toEqual(['older', 'newer']);
  });

  it('does not mutate the input array', () => {
    const items = [makeItem({ paymentId: 'x' }), makeItem({ paymentId: 'y' })];
    const copy = [...items];
    sortPaymentQueue(items);
    expect(items).toEqual(copy);
  });
});

describe('computeSummary', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  it('counts pending items (payment_required + on_hold) and their amount', () => {
    const items = [
      makeItem({ status: 'payment_required', amount: 500 }),
      makeItem({ status: 'on_hold', amount: 300 }),
      makeItem({ status: 'paid', amount: 999, paidAt: new Date().toISOString() })
    ];
    const summary = computeSummary(items);
    expect(summary.pendingCount).toBe(2);
    expect(summary.pendingAmount).toBe(800);
  });

  it('buckets overdue vs due-today amounts separately', () => {
    const items = [
      makeItem({ status: 'payment_required', amount: 100, dueDate: new Date(now - 5 * day).toISOString() }),
      makeItem({ status: 'payment_required', amount: 200, dueDate: new Date(now).toISOString() }),
      makeItem({ status: 'payment_required', amount: 300, dueDate: new Date(now + 10 * day).toISOString() })
    ];
    const summary = computeSummary(items);
    expect(summary.overdueAmount).toBe(100);
    expect(summary.dueTodayAmount).toBe(200);
  });

  it('only counts paid items from the current calendar month toward paidThisMonthAmount', () => {
    const thisMonth = new Date();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const items = [
      makeItem({ status: 'paid', amount: 400, paidAt: thisMonth.toISOString() }),
      makeItem({ status: 'paid', amount: 999, paidAt: lastMonth.toISOString() })
    ];
    const summary = computeSummary(items);
    expect(summary.paidThisMonthAmount).toBe(400);
  });

  it('returns all zeros for an empty list', () => {
    const summary = computeSummary([]);
    expect(summary).toEqual({ pendingCount: 0, pendingAmount: 0, dueTodayAmount: 0, overdueAmount: 0, paidThisMonthAmount: 0 });
  });
});
