import { BRAND } from '@/lib/branding';
import { escapeHtml, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export interface AccountsPaymentDoneEmailData {
  /** The recipient — whoever raised the thing that has now been paid. */
  name: string;
  /** "Reimbursement Sheet", "BOM Request", "Travel Request", … */
  sourceLabel: string;
  /** What was paid, in the queue's own words (item, project, code). */
  description: string;
  amount: string;
  /** The date Accounts recorded the payment on, not the date this was sent. */
  paymentDate: string;
  paymentMethod: string;
  /** UTR / cheque number / transfer id. '' when none was recorded. */
  paymentReference: string;
  /** Who in Accounts processed it. */
  paidBy: string;
  remarks: string;
  url: string;
}

// "Your payment has gone out."
//
// The Accounts Payment Queue settles five different kinds of payable
// (reimbursement sheets, BOM requests, travel requests, admin and office
// expense sheets) and, until this existed, told NOBODY when it did. The
// person who raised the claim found out by noticing the money, or by going
// back to the page and seeing it had changed to paid.
//
// Deliberately carries the payment DATE, METHOD and REFERENCE rather than
// just "it's done": the first question anyone asks on receiving this is
// "which transfer was that?", and a reference they can match against their
// bank statement is the whole point. The date is the one Accounts recorded,
// which can be earlier than the day this email goes out.
export function renderAccountsPaymentDoneEmail(data: AccountsPaymentDoneEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const subject = `Payment done — ${data.description} (${data.amount})`;
  const intro =
    `Your ${data.sourceLabel.toLowerCase()} has been paid. Accounts recorded this payment on ${data.paymentDate}` +
    `${data.paidBy ? `, processed by ${data.paidBy}` : ''}.`;

  const detailLines = [
    `What: ${data.description}`,
    `Amount: ${data.amount}`,
    `Paid on: ${data.paymentDate}`,
    `Method: ${data.paymentMethod || '-'}`,
    ...(data.paymentReference ? [`Reference: ${data.paymentReference}`] : []),
    ...(data.remarks ? [`Remarks from Accounts: ${data.remarks}`] : [])
  ];

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...detailLines,
    '',
    `View it here: ${data.url}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${renderInfoBox(
                  detailLines
                    .map((line) => `<p style="margin:0 0 8px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`)
                    .join('')
                )}
                <p style="margin:24px 0 0; font-size:14px;"><a href="${escapeHtml(data.url)}" style="color:#2563eb;">View it in ${escapeHtml(appName)}</a></p>`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
