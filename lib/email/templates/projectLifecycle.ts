import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export type ProjectLifecycleEvent =
  | 'assigned'
  | 'status_changed'
  | 'tms_status_changed'
  | 'handover_requested'
  | 'handover_approved'
  | 'handover_rejected'
  | 'handover_cancelled';

export interface ProjectLifecycleEmailData {
  name: string;
  event: ProjectLifecycleEvent;
  projectLabel: string;
  // Free-text context line, meaning depends on the event — e.g. "Status:
  // Won", "Requested by <name>", "Reason: <remarks>".
  detail?: string;
  projectUrl: string;
}

const EVENT_COPY: Record<ProjectLifecycleEvent, { subject: string; intro: (projectLabel: string) => string; accentColor: string }> = {
  assigned: {
    subject: 'A Project Was Assigned to You',
    intro: (label) => `You have been assigned as the technical lead on "${label}".`,
    accentColor: '#2563eb'
  },
  status_changed: {
    subject: 'Project Status Updated',
    intro: (label) => `The status of "${label}" has changed.`,
    accentColor: '#2563eb'
  },
  tms_status_changed: {
    subject: 'Project Status Updated',
    intro: (label) => `The status of "${label}" has changed.`,
    accentColor: '#2563eb'
  },
  handover_requested: {
    subject: 'Project Handover Request',
    intro: (label) => `Someone wants to hand over "${label}" to you.`,
    accentColor: '#2563eb'
  },
  handover_approved: {
    subject: 'Project Handover Approved',
    intro: (label) => `Your handover request for "${label}" was accepted.`,
    accentColor: '#16a34a'
  },
  handover_rejected: {
    subject: 'Project Handover Declined',
    intro: (label) => `Your handover request for "${label}" was declined.`,
    accentColor: '#dc2626'
  },
  handover_cancelled: {
    subject: 'Project Handover Request Cancelled',
    intro: (label) => `A pending handover request for "${label}" was cancelled by the sender.`,
    accentColor: '#6b7280'
  }
};

export function renderProjectLifecycleEmail(data: ProjectLifecycleEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const copy = EVENT_COPY[data.event];
  const subject = `${copy.subject} — ${data.projectLabel}`;
  const intro = copy.intro(data.projectLabel);

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...(data.detail ? [data.detail, ''] : []),
    `View project: ${data.projectUrl}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${data.detail ? renderInfoBox(`<p style="margin:0; font-size:14px; color:#111827;">${escapeHtml(data.detail)}</p>`) : ''}
                ${renderButton(data.projectUrl, 'View Project', copy.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
