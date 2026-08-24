import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export type ProcurementLifecycleEvent =
  | 'bom_submitted'
  | 'bom_approved'
  | 'bom_pending_admin'
  | 'bom_rejected'
  | 'bom_admin_approved'
  | 'bom_admin_rejected'
  | 'bom_finance_approved'
  | 'bom_finance_rejected'
  | 'bom_payment_done'
  | 'procurement_received'
  | 'procurement_status_changed'
  | 'po_created';

export interface ProcurementLifecycleEmailData {
  name: string;
  event: ProcurementLifecycleEvent;
  itemLabel: string;
  projectName: string;
  detail?: string;
  procurementUrl: string;
}

const EVENT_COPY: Record<ProcurementLifecycleEvent, { subject: string; intro: (item: string, project: string) => string; accentColor: string }> = {
  bom_submitted: {
    subject: 'New BOM Request Awaiting Review',
    intro: (item, project) => `A new BOM request for "${item}" on ${project} needs your review.`,
    accentColor: '#2563eb'
  },
  bom_approved: {
    subject: 'BOM Request Approved',
    intro: (item, project) => `Your BOM request for "${item}" on ${project} was approved by the Technical Manager.`,
    accentColor: '#16a34a'
  },
  bom_pending_admin: {
    subject: 'BOM Request Awaiting Administration Approval',
    intro: (item, project) => `A BOM request for "${item}" on ${project} needs Administration approval.`,
    accentColor: '#2563eb'
  },
  bom_rejected: {
    subject: 'BOM Request Declined',
    intro: (item, project) => `Your BOM request for "${item}" on ${project} was declined.`,
    accentColor: '#dc2626'
  },
  bom_admin_approved: {
    subject: 'BOM Request Awaiting Finance Approval',
    intro: (item, project) => `A BOM request for "${item}" on ${project} needs Finance approval.`,
    accentColor: '#2563eb'
  },
  bom_admin_rejected: {
    subject: 'BOM Request Declined by Administration',
    intro: (item, project) => `Your BOM request for "${item}" on ${project} was declined by Administration.`,
    accentColor: '#dc2626'
  },
  bom_finance_approved: {
    subject: 'BOM Request Awaiting Payment',
    intro: (item, project) => `A BOM request for "${item}" on ${project} was finance-approved and is awaiting payment.`,
    accentColor: '#2563eb'
  },
  bom_finance_rejected: {
    subject: 'BOM Request Declined by Finance',
    intro: (item, project) => `Your BOM request for "${item}" on ${project} was declined by Finance.`,
    accentColor: '#dc2626'
  },
  bom_payment_done: {
    subject: 'Payment Done — Collect Your Material',
    intro: (item, project) => `Payment for "${item}" on ${project} is complete. Mark it received once the material is in hand.`,
    accentColor: '#16a34a'
  },
  procurement_received: {
    subject: 'Procurement Delivered',
    intro: (item, project) => `"${item}" for ${project} has been received.`,
    accentColor: '#16a34a'
  },
  procurement_status_changed: {
    subject: 'Procurement Status Updated',
    intro: (item, project) => `The purchase status of "${item}" for ${project} has changed.`,
    accentColor: '#2563eb'
  },
  po_created: {
    subject: 'Purchase Order Received',
    intro: (item, project) => `Purchase order ${item} was recorded for ${project}.`,
    accentColor: '#16a34a'
  }
};

export function renderProcurementLifecycleEmail(data: ProcurementLifecycleEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const copy = EVENT_COPY[data.event];
  const subject = `${copy.subject} — ${data.itemLabel}`;
  const intro = copy.intro(data.itemLabel, data.projectName);

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...(data.detail ? [data.detail, ''] : []),
    `View details: ${data.procurementUrl}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${data.detail ? renderInfoBox(`<p style="margin:0; font-size:14px; color:#111827;">${escapeHtml(data.detail)}</p>`) : ''}
                ${renderButton(data.procurementUrl, 'View Details', copy.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
