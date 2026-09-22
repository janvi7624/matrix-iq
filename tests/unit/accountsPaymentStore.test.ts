import { describe, it, expect } from 'vitest';
import { sortPaymentQueue, computeSummary, parsePaymentId, groupOfficeExpenseRows } from '../../lib/accountsPaymentStore';
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

describe('groupOfficeExpenseRows (Office Operation Expense monthly sheets)', () => {
  const hardik = { id: 'u1', username: 'hardik', name: 'Hardik Acharya' };
  const medha = { id: 'u2', username: 'medha', name: 'Medha Dave' };
  // The REAL shape of OfficeOperationExpense.get({ plain: true }): DECIMAL
  // amounts as strings, timestamps as Date objects, and — because the model
  // is `underscored: true` — the auto timestamp under `createdAt`, NOT
  // `created_at` (that key is undefined on real rows). An earlier version of
  // this fixture used `created_at` strings, which let a missing-due-date bug
  // pass here while every real sheet showed no due date.
  function row(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      id: `e-${Math.random()}`, date: '2026-09-05', usecase: 'Office', usecase_detail: '', item_name: 'Pantry',
      item_sub_names: [], item_qty: null, amount: '100.00', description: '', remarks: '',
      payment_status: 'payment_required', paid_at: null, paid_by: null, payment_method: null, payment_reference: null,
      createdAt: new Date('2026-09-05T10:00:00.000Z'), creator: hardik, ...overrides
    };
  }

  it('collapses every unpaid entry in a month into ONE sheet keyed by the month', () => {
    const sheets = groupOfficeExpenseRows([row({}), row({ date: '2026-09-18' }), row({ date: '2026-09-30' })], new Map());
    expect(sheets).toHaveLength(1);
    expect(sheets[0].item.paymentId).toBe('office_expense:2026-09');
    expect(sheets[0].item.status).toBe('payment_required');
    expect(sheets[0].entries).toHaveLength(3);
    expect(sheets[0].item.description).toBe('Office Operation Expenses — September 2026 (3 entries)');
  });

  it('sums DECIMAL-as-string amounts without floating-point drift', () => {
    const sheets = groupOfficeExpenseRows([row({ amount: '0.10' }), row({ amount: '0.20' }), row({ amount: '1000.33' })], new Map());
    expect(sheets[0].item.amount).toBe(1000.63);
  });

  it('keeps different months as separate sheets', () => {
    const sheets = groupOfficeExpenseRows([row({ date: '2026-08-31' }), row({ date: '2026-09-01' })], new Map());
    expect(sheets.map((s) => s.item.sourceId).sort()).toEqual(['2026-08', '2026-09']);
  });

  it('keeps a month\'s paid entries apart from its unpaid ones', () => {
    const sheets = groupOfficeExpenseRows([
      row({}),
      row({ payment_status: 'paid', paid_at: new Date('2026-09-10T00:00:00.000Z'), paid_by: 'u9' })
    ], new Map([['u9', 'Vaishali Jagani']]));
    const pending = sheets.find((s) => s.item.status === 'payment_required');
    const paid = sheets.find((s) => s.item.status === 'paid');
    expect(pending?.item.sourceId).toBe('2026-09');
    expect(paid?.item.sourceId).toBe(`2026-09~${new Date('2026-09-10T00:00:00.000Z').getTime()}`);
    expect(paid?.item.paidBy).toBe('Vaishali Jagani');
  });

  it('separates two payments of the same month into two history rows', () => {
    const sheets = groupOfficeExpenseRows([
      row({ payment_status: 'paid', paid_at: new Date('2026-09-10T00:00:00.000Z') }),
      row({ payment_status: 'paid', paid_at: new Date('2026-09-20T00:00:00.000Z') })
    ], new Map());
    expect(sheets).toHaveLength(2);
  });

  it('groups rows backfilled as already-paid (no paid_at) under a legacy key, never payable', () => {
    const sheets = groupOfficeExpenseRows([row({ payment_status: 'paid' }), row({ payment_status: 'paid' })], new Map());
    expect(sheets).toHaveLength(1);
    expect(sheets[0].item.sourceId).toBe('2026-09~legacy');
    expect(sheets[0].item.status).toBe('paid');
  });

  it('lists every distinct person who logged entries, for payee and hold notifications', () => {
    const sheets = groupOfficeExpenseRows([row({}), row({ creator: medha }), row({})], new Map());
    expect(sheets[0].item.payee).toBe('Hardik Acharya, Medha Dave');
    expect(sheets[0].requesterUsernames).toEqual(['hardik', 'medha']);
  });

  it('dates the sheet by its OLDEST waiting entry, so an early entry keeps it overdue', () => {
    const sheets = groupOfficeExpenseRows([
      row({ createdAt: new Date('2026-09-20T10:00:00.000Z') }),
      row({ createdAt: new Date('2026-09-02T10:00:00.000Z') })
    ], new Map());
    expect(sheets[0].item.createdAt).toBe('2026-09-02T10:00:00.000Z');
    expect(sheets[0].item.approvedAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('skips a row with no usable date rather than inventing a month for it', () => {
    expect(groupOfficeExpenseRows([row({ date: null })], new Map())).toHaveLength(0);
  });
});

describe('groupOfficeExpenseRows — timestamp handling (regression)', () => {
  const creator = { id: 'u1', username: 'hardik', name: 'Hardik Acharya' };
  const base = {
    id: 'e1', date: '2026-09-05', usecase: 'Office', usecase_detail: '', item_name: 'Pantry', item_sub_names: [],
    item_qty: null, amount: '100.00', description: '', remarks: '', paid_by: null, payment_method: null,
    payment_reference: null, creator
  };

  it('gives a sheet a due date from the real camelCase `createdAt` Date (was always "—")', () => {
    const [sheet] = groupOfficeExpenseRows([{ ...base, payment_status: 'payment_required', paid_at: null, createdAt: new Date('2026-09-05T10:00:00.000Z') }], new Map());
    expect(sheet.item.createdAt).toBe('2026-09-05T10:00:00.000Z');
    expect(sheet.item.dueDate).toBe('2026-09-08T10:00:00.000Z'); // + the 3-day payment SLA
  });

  it('emits paidAt as ISO, not Date#toString() ("Mon Sep …" does not sort chronologically)', () => {
    const [sheet] = groupOfficeExpenseRows([{ ...base, payment_status: 'paid', paid_at: new Date('2026-09-10T00:00:00.000Z'), createdAt: new Date('2026-09-05T10:00:00.000Z') }], new Map());
    expect(sheet.item.paidAt).toBe('2026-09-10T00:00:00.000Z');
  });

  it('still accepts a snake_case `created_at` if a caller ever supplies one', () => {
    const [sheet] = groupOfficeExpenseRows([{ ...base, payment_status: 'payment_required', paid_at: null, created_at: '2026-09-05T10:00:00.000Z' }], new Map());
    expect(sheet.item.dueDate).not.toBeNull();
  });
});
