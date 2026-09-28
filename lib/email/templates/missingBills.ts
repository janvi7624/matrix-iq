import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export interface MissingBillsEmailData {
  name: string;
  bills: { date: string; description: string; amount: string }[];
  reimbursementUrl: string;
}

const MAX_LISTED = 12;

export function renderMissingBillsEmail(data: MissingBillsEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const n = data.bills.length;
  const subject = `Please upload your reimbursement ${n === 1 ? 'bill' : 'bills'} again`;
  const intro =
    `Our old file storage was lost, so the bill files attached to ${n === 1 ? 'one of your reimbursement claims' : `${n} of your reimbursement claims`} can no longer be opened. ` +
    'Your claims and amounts are unchanged — only the attached photo or PDF is gone. ' +
    'Please open Reimbursement and use "Upload bill again" on each claim below, using the original from your phone (WhatsApp) or your email.';

  const shown = data.bills.slice(0, MAX_LISTED);
  const lines = shown.map((b) => `${b.date} — ${b.description || 'Claim'} — ${b.amount}`);
  if (data.bills.length > shown.length) lines.push(`…and ${data.bills.length - shown.length} more (they are all listed on the Reimbursement page).`);

  const text = [`Hello ${data.name},`, '', intro, '', ...lines, '', `Upload them here: ${data.reimbursementUrl}`, '', 'Regards,', `${appName} Team`].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${renderInfoBox(lines.map((line) => `<p style="margin:0 0 8px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`).join(''))}
                ${renderButton(data.reimbursementUrl, 'Upload Bills Again', '#d97706')}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
