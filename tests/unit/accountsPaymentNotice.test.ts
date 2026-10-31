import { describe, it, expect } from 'vitest';
import {
  PAYMENT_SOURCE_LABEL,
  formatPaymentAmount,
  paymentDoneNotification,
  paymentSourcePath
} from '../../lib/accountsPaymentNotice';
import { PaymentSource } from '../../lib/types';

// The Accounts Payment Queue's payment-done notice.
//
// The queue settles five kinds of payable and used to notify nobody at all —
// whoever raised the claim found out by noticing the money arrive. These
// tests pin the two things that would make the notice worse than useless: a
// link that 404s, and an amount or reference the recipient cannot match
// against their bank statement.

const ALL_SOURCES: PaymentSource[] = [
  'reimbursement_sheet',
  'admin_expense',
  'office_expense',
  'bom_request',
  'travel_schedule'
];

describe('paymentSourcePath', () => {
  // Only these two have a real [id] route. app/reimbursement has no [id]
  // page and the expense sheets are monthly groupings, not records.
  it('links to the record where one exists', () => {
    expect(paymentSourcePath('bom_request', 'bom-1')).toBe('/tms/bom-requests/bom-1');
    expect(paymentSourcePath('travel_schedule', 'trip-1')).toBe('/travel-schedule/trip-1');
  });

  it('links to the register where there is no per-record page', () => {
    expect(paymentSourcePath('reimbursement_sheet', 'sheet-1')).toBe('/reimbursement');
    expect(paymentSourcePath('office_expense', '2026-10')).toBe('/office-operation-expenses');
    expect(paymentSourcePath('admin_expense', 'batch-1')).toBe('/admin-expenses');
  });

  // A 404 in an email about somebody's money is worse than no link.
  it('never embeds an id in a path that has no id route', () => {
    for (const source of ['reimbursement_sheet', 'office_expense', 'admin_expense'] as PaymentSource[]) {
      expect(paymentSourcePath(source, 'some-id')).not.toContain('some-id');
    }
  });

  it('gives every source a path', () => {
    for (const source of ALL_SOURCES) {
      expect(paymentSourcePath(source, 'x')).toMatch(/^\//);
    }
  });
});

describe('PAYMENT_SOURCE_LABEL', () => {
  it('names every source', () => {
    for (const source of ALL_SOURCES) {
      expect(PAYMENT_SOURCE_LABEL[source]).toBeTruthy();
    }
  });
});

describe('formatPaymentAmount', () => {
  // Always two decimals: this is a figure somebody compares against a bank
  // statement, and ₹1,200 vs ₹1,200.50 is a question nobody should have to ask.
  it('always shows paise', () => {
    expect(formatPaymentAmount(1200)).toBe('₹1,200.00');
    expect(formatPaymentAmount(1200.5)).toBe('₹1,200.50');
  });

  it('groups in the Indian system', () => {
    expect(formatPaymentAmount(1234567)).toBe('₹12,34,567.00');
  });

  it('does not print NaN at somebody', () => {
    expect(formatPaymentAmount(Number.NaN)).toBe('₹0.00');
    expect(formatPaymentAmount(Number.POSITIVE_INFINITY)).toBe('₹0.00');
  });

  it('rounds rather than running on', () => {
    expect(formatPaymentAmount(10.005)).toBe('₹10.01');
  });
});

describe('paymentDoneNotification', () => {
  const input = {
    sourceLabel: 'Reimbursement Sheet',
    description: 'October travel claim',
    amountLabel: '₹4,500.00',
    paymentDate: '2026-10-30',
    paymentMethod: 'NEFT',
    paymentReference: 'UTR123456',
    paidByName: 'Vaishali Jagani'
  };

  it('leads with the amount, because that is what identifies it', () => {
    expect(paymentDoneNotification(input).title).toBe('Payment done — ₹4,500.00');
  });

  it('carries the date, method and reference', () => {
    const body = paymentDoneNotification(input).body;
    expect(body).toContain('October travel claim');
    expect(body).toContain('2026-10-30');
    expect(body).toContain('NEFT');
    expect(body).toContain('UTR123456');
    expect(body).toContain('Vaishali Jagani');
  });

  // A reference is not always recorded — the sentence must still read.
  it('omits the reference cleanly when there is none', () => {
    const body = paymentDoneNotification({ ...input, paymentReference: '' }).body;
    expect(body).not.toContain('Ref:');
    expect(body).toContain('was paid on 2026-10-30 by NEFT.');
  });

  it('falls back when the method is blank', () => {
    expect(paymentDoneNotification({ ...input, paymentMethod: '' }).body).toContain('by Accounts');
  });

  it('omits the processor when unknown', () => {
    const body = paymentDoneNotification({ ...input, paidByName: '' }).body;
    expect(body).not.toContain('Processed by');
  });
});
