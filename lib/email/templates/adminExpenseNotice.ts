import { BRAND } from '@/lib/branding';
import { escapeHtml, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export interface AdminExpenseNoticeEmailData {
  name: string;
  expenseType: string;
  totalAmount: string;
  employeeNames: string[];
  addedBy: string;
  date: string;
  action: 'created' | 'updated';
}

// Admin Expenses (components/AdminExpensesView.tsx) are company-paid
// entries created directly by Admin/HR with NO manager/HR/accounts
// approval chain at all (unlike a regular Reimbursement sheet, which
// always passes through HR before payment — see
// reimbursementLifecycle.ts). This is the only notice Accounts ever gets
// of one, since nothing else in that flow tells them money moved.
export function renderAdminExpenseNoticeEmail(data: AdminExpenseNoticeEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const verb = data.action === 'created' ? 'A new' : 'An updated';
  const subject = `${verb} company-paid expense — ${data.expenseType} (${data.totalAmount})`;
  const intro = `${verb} company-paid expense entry (${data.expenseType}) totaling ${data.totalAmount} was ${data.action} by ${data.addedBy}. This type of entry has no manager/HR approval step, so this email is your only notice of it.`;

  const detailLines = [
    `Type: ${data.expenseType}`,
    `Total: ${data.totalAmount}`,
    `Date: ${data.date}`,
    `Employees: ${data.employeeNames.join(', ') || '-'}`,
    `Added by: ${data.addedBy}`
  ];

  const text = [`Hello ${data.name},`, '', intro, '', ...detailLines, '', 'Regards,', `${appName} Team`].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${renderInfoBox(detailLines.map((line) => `<p style="margin:0 0 8px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`).join(''))}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
