import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export type ReimbursementEvent =
  | 'submitted'
  | 'manager_approved'
  | 'manager_change_requested'
  | 'hr_approved'
  | 'hr_change_requested'
  | 'payment_done';

export interface ReimbursementLifecycleEmailData {
  name: string;
  event: ReimbursementEvent;
  employeeName: string;
  employeeId: string;
  department: string;
  sheetCode: string;
  month: string;
  year: number;
  totalAmount: string;
  remarks?: string;
  paymentReference?: string;
  reimbursementUrl: string;
}

const EVENT_COPY: Record<ReimbursementEvent, { subject: (emp: string, period: string) => string; intro: (emp: string, period: string, amount: string) => string; accentColor: string }> = {
  submitted: {
    subject: (emp, period) => `Reimbursement Approval Needed — ${emp} (${period})`,
    intro: (emp, period, amount) => `${emp} has submitted their reimbursement sheet for ${period} totaling ${amount}. Please review and take action.`,
    accentColor: '#d97706',
  },
  manager_approved: {
    subject: (emp, period) => `Reimbursement Approved by Manager — ${emp} (${period})`,
    intro: (emp, period, amount) => `${emp}'s reimbursement sheet for ${period} (${amount}) has been approved by the department manager and is now awaiting HR review.`,
    accentColor: '#2563eb',
  },
  manager_change_requested: {
    subject: (emp, period) => `Reimbursement Changes Requested — ${period}`,
    intro: (emp, period, amount) => `Your reimbursement sheet for ${period} (${amount}) has been sent back by the manager for changes.`,
    accentColor: '#dc2626',
  },
  hr_approved: {
    subject: (emp, period) => `Reimbursement Approved by HR — ${emp} (${period})`,
    intro: (emp, period, amount) => `${emp}'s reimbursement sheet for ${period} (${amount}) has been approved by HR and is ready for payment processing.`,
    accentColor: '#7c3aed',
  },
  hr_change_requested: {
    subject: (emp, period) => `Reimbursement Changes Requested by HR — ${period}`,
    intro: (emp, period, amount) => `Your reimbursement sheet for ${period} (${amount}) has been sent back by HR for changes.`,
    accentColor: '#dc2626',
  },
  payment_done: {
    subject: (_emp, period) => `Reimbursement Payment Completed — ${period}`,
    intro: (_emp, period, amount) => `Your reimbursement for ${period} (${amount}) has been processed and payment is done.`,
    accentColor: '#16a34a',
  },
};

export function renderReimbursementLifecycleEmail(data: ReimbursementLifecycleEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const copy = EVENT_COPY[data.event];
  const period = `${data.month} ${data.year}`;
  const subject = copy.subject(data.employeeName, period);
  const intro = copy.intro(data.employeeName, period, data.totalAmount);

  const detailLines: string[] = [
    `Employee: ${data.employeeName} (${data.employeeId})`,
    `Department: ${data.department}`,
    `Sheet: ${data.sheetCode}`,
    `Period: ${period}`,
    `Total: ${data.totalAmount}`,
  ];
  if (data.remarks) detailLines.push(`Remarks: ${data.remarks}`);
  if (data.paymentReference) detailLines.push(`Payment Reference: ${data.paymentReference}`);

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...detailLines,
    '',
    `View reimbursement: ${data.reimbursementUrl}`,
    '',
    'Regards,',
    `${appName} Team`,
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${renderInfoBox(detailLines.map((line) => `<p style="margin:0 0 8px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`).join(''))}
                ${renderButton(data.reimbursementUrl, 'View Reimbursement', copy.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
