import { BRAND } from '@/lib/branding';
import { formatMoney } from '@/lib/format';
import { QuotationStatus } from '@/lib/types';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export interface QuotationStatusChangedEmailData {
  name: string;
  quotationNumber: string;
  clientName: string;
  status: Extract<QuotationStatus, 'sent' | 'approved' | 'rejected'>;
  total: number;
  quotationsUrl: string;
}

const STATUS_COPY: Record<QuotationStatusChangedEmailData['status'], { label: string; color: string; verb: string }> = {
  sent: { label: 'Sent', color: '#2563eb', verb: 'has been marked as sent to the client' },
  approved: { label: 'Approved', color: '#16a34a', verb: 'has been approved' },
  rejected: { label: 'Rejected', color: '#dc2626', verb: 'has been rejected' }
};

export function renderQuotationStatusChangedEmail(data: QuotationStatusChangedEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const copy = STATUS_COPY[data.status];
  const subject = `Quotation ${data.quotationNumber} ${copy.label}`;
  const clientLine = data.clientName ? ` for ${data.clientName}` : '';

  const text = [
    `Hello ${data.name},`,
    '',
    `Quotation ${data.quotationNumber}${clientLine} ${copy.verb}.`,
    '',
    `Amount: ${formatMoney(data.total)}`,
    `Status: ${copy.label}`,
    '',
    `View your quotations: ${data.quotationsUrl}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">
                  Quotation <strong>${escapeHtml(data.quotationNumber)}</strong>${clientLine ? ` for <strong>${escapeHtml(data.clientName)}</strong>` : ''} ${escapeHtml(copy.verb)}.
                </p>
                ${renderInfoBox(`
                      <p style="margin:0 0 8px; font-size:14px; color:#6b7280;">Status</p>
                      <p style="margin:0 0 16px; font-size:15px; font-weight:bold; color:${copy.color};">${escapeHtml(copy.label)}</p>
                      <p style="margin:0 0 8px; font-size:14px; color:#6b7280;">Amount</p>
                      <p style="margin:0; font-size:15px; color:#111827; font-weight:bold;">${escapeHtml(formatMoney(data.total))}</p>`)}
                ${renderButton(data.quotationsUrl, 'View My Quotations', BRAND.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
