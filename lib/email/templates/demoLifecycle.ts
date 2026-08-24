import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export type DemoLifecycleEvent = 'technical_confirmation' | 'manager_approval' | 'backoffice_ready' | 'cancelled' | 'completed';

export interface DemoLifecycleEmailData {
  name: string;
  event: DemoLifecycleEvent;
  clientName: string;
  company?: string;
  scheduledAt?: string;
  // Free-text context line, meaning depends on the event — "confirmed by
  // <name>", "approved by <name>", or a cancellation/outcome note.
  detail?: string;
  demoUrl: string;
}

const EVENT_COPY: Record<DemoLifecycleEvent, { subject: string; intro: (clientLine: string) => string; accentColor: string }> = {
  technical_confirmation: {
    subject: 'New Demo Request Needs Your Confirmation',
    intro: (clientLine) => `A new demo request for ${clientLine} needs your availability confirmation.`,
    accentColor: '#2563eb'
  },
  manager_approval: {
    subject: 'Demo Request Needs Your Approval',
    intro: (clientLine) => `A demo request for ${clientLine} is awaiting your approval.`,
    accentColor: '#2563eb'
  },
  backoffice_ready: {
    subject: 'Demo Request Ready for Back Office',
    intro: (clientLine) => `A demo request for ${clientLine} has been approved and is ready for logistics.`,
    accentColor: '#2563eb'
  },
  cancelled: {
    subject: 'Demo Request Cancelled',
    intro: (clientLine) => `The demo request for ${clientLine} has been cancelled.`,
    accentColor: '#dc2626'
  },
  completed: {
    subject: 'Demo Marked as Completed',
    intro: (clientLine) => `The demo for ${clientLine} has been marked as completed.`,
    accentColor: '#16a34a'
  }
};

export function renderDemoLifecycleEmail(data: DemoLifecycleEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const copy = EVENT_COPY[data.event];
  const clientLine = data.company ? `${data.clientName} (${data.company})` : data.clientName;
  const subject = `${copy.subject} — ${data.clientName}`;
  const intro = copy.intro(clientLine);

  const detailLines: string[] = [];
  if (data.scheduledAt) {
    const formatted = new Date(data.scheduledAt).toLocaleString('en-IN');
    if (formatted !== 'Invalid Date') detailLines.push(`Scheduled: ${formatted}`);
  }
  if (data.detail) detailLines.push(data.detail);

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...(detailLines.length ? [...detailLines, ''] : []),
    `View demo requests: ${data.demoUrl}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${detailLines.length ? renderInfoBox(detailLines.map((line) => `<p style="margin:0 0 8px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`).join('')) : ''}
                ${renderButton(data.demoUrl, 'View Demo Requests', copy.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
