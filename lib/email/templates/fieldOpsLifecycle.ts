import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';
import { BRAND } from '@/lib/branding';

export type FieldOpsLifecycleEvent = 'site_visit_created' | 'site_visit_closed' | 'installation_scheduled' | 'installation_completed' | 'dc_dispatched' | 'dc_closed';

export interface FieldOpsLifecycleEmailData {
  name: string;
  event: FieldOpsLifecycleEvent;
  subjectLabel: string;
  detail?: string;
  url: string;
}

const EVENT_COPY: Record<FieldOpsLifecycleEvent, { subject: string; intro: (label: string) => string; accentColor: string; linkText: string }> = {
  site_visit_created: {
    subject: 'You Were Added to a Site Visit',
    intro: (label) => `A site visit for ${label} was logged and you're listed on the team.`,
    accentColor: '#2563eb',
    linkText: 'View Site Visits'
  },
  site_visit_closed: {
    subject: 'Site Visit Closed',
    intro: (label) => `The site visit for ${label} has been closed.`,
    accentColor: '#16a34a',
    linkText: 'View Site Visits'
  },
  installation_scheduled: {
    subject: 'Installation Scheduled',
    intro: (label) => `An installation for ${label} has been scheduled.`,
    accentColor: '#2563eb',
    linkText: 'View Installations'
  },
  installation_completed: {
    subject: 'Installation Completed',
    intro: (label) => `The installation for ${label} has been completed.`,
    accentColor: '#16a34a',
    linkText: 'View Installations'
  },
  dc_dispatched: {
    subject: 'Materials Dispatched',
    intro: (label) => `Materials on Delivery Challan ${label} have been dispatched.`,
    accentColor: '#2563eb',
    linkText: 'View Back Office'
  },
  dc_closed: {
    subject: 'Delivery Challan Closed',
    intro: (label) => `Delivery Challan ${label} has been closed — the loan cycle is complete.`,
    accentColor: '#16a34a',
    linkText: 'View Back Office'
  }
};

export function renderFieldOpsLifecycleEmail(data: FieldOpsLifecycleEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const copy = EVENT_COPY[data.event];
  const subject = `${copy.subject} — ${data.subjectLabel}`;
  const intro = copy.intro(data.subjectLabel);

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...(data.detail ? [data.detail, ''] : []),
    `${copy.linkText}: ${data.url}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${data.detail ? renderInfoBox(`<p style="margin:0; font-size:14px; color:#111827;">${escapeHtml(data.detail)}</p>`) : ''}
                ${renderButton(data.url, copy.linkText, copy.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
