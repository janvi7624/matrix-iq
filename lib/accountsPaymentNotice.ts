import { PaymentSource } from './types';

// Where the payment-done notice points, and what it calls the thing.
//
// Pure: no db imports, so the link rules are testable and the notification
// cannot quietly start linking somewhere that does not exist.
//
// The Accounts Payment Queue settles five different kinds of payable and had
// no notification at all — whoever raised the claim found out by noticing
// the money arrive. This module is the addressing half of fixing that.

export const PAYMENT_SOURCE_LABEL: Record<PaymentSource, string> = {
  reimbursement_sheet: 'Reimbursement Sheet',
  admin_expense: 'Admin Expense',
  office_expense: 'Office Operation Expense',
  bom_request: 'BOM Request',
  travel_schedule: 'Travel Request'
};

/**
 * The page to send the recipient to.
 *
 * Only BOM requests and travel requests have a per-record page
 * (app/tms/bom-requests/[id], app/travel-schedule/[id]). Reimbursement has
 * no [id] route at all — app/reimbursement is a single page — and the two
 * expense sources are monthly groupings rather than records. Those three
 * link to their register, which is what the existing reimbursement emails
 * already do. A link that 404s is worse than a link to the list.
 */
export function paymentSourcePath(source: PaymentSource, sourceId: string): string {
  switch (source) {
    case 'bom_request':
      return `/tms/bom-requests/${sourceId}`;
    case 'travel_schedule':
      return `/travel-schedule/${sourceId}`;
    case 'reimbursement_sheet':
      return '/reimbursement';
    case 'office_expense':
      return '/office-operation-expenses';
    case 'admin_expense':
      return '/admin-expenses';
    default:
      return '/';
  }
}

/**
 * The amount as the recipient should read it — matching the ₹ + en-IN
 * grouping the rest of this module already uses inline (see
 * accountsPaymentStore's own expectedAmount messages and
 * adminExpenseAccess), with paise always shown because this is a figure
 * somebody will compare against a bank statement.
 */
export function formatPaymentAmount(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `₹${safe.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface PaymentNoticeInput {
  sourceLabel: string;
  description: string;
  amountLabel: string;
  paymentDate: string;
  paymentMethod: string;
  paymentReference: string;
  paidByName: string;
}

/**
 * The in-app bell copy, kept beside the email's so the two say the same
 * thing. Leads with the amount and the date, because "which payment was
 * that" is the question this answers.
 */
export function paymentDoneNotification(input: PaymentNoticeInput): { title: string; body: string } {
  const reference = input.paymentReference ? ` · Ref: ${input.paymentReference}` : '';
  return {
    title: `Payment done — ${input.amountLabel}`,
    body:
      `${input.description} was paid on ${input.paymentDate} by ${input.paymentMethod || 'Accounts'}${reference}.` +
      `${input.paidByName ? ` Processed by ${input.paidByName}.` : ''}`
  };
}
