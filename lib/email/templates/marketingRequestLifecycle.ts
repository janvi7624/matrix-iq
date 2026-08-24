import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export type MarketingRequestLifecycleEvent =
  | 'created'
  | 'assigned'
  | 'assignment_accepted'
  | 'assignment_declined'
  | 'approved'
  | 'rejected'
  | 'timeline_set'
  | 'technical_review_assigned'
  | 'technical_approved'
  | 'technical_changes_requested'
  | 'completed'
  | 'info_needed'
  | 'priority_changed'
  | 'comment';

export interface MarketingRequestLifecycleEmailData {
  name: string;
  event: MarketingRequestLifecycleEvent;
  title: string;
  detail?: string;
  requestsUrl: string;
}

const EVENT_COPY: Record<MarketingRequestLifecycleEvent, { subject: string; intro: (title: string) => string; accentColor: string }> = {
  created: {
    subject: 'New Marketing Request',
    intro: (title) => `A new marketing request "${title}" was submitted to you.`,
    accentColor: '#2563eb'
  },
  assigned: {
    subject: 'Marketing Request Assigned to You',
    intro: (title) => `"${title}" was assigned to you. Please confirm your availability.`,
    accentColor: '#2563eb'
  },
  assignment_accepted: {
    subject: 'Assignment Accepted',
    intro: (title) => `The assignee confirmed availability for "${title}".`,
    accentColor: '#16a34a'
  },
  assignment_declined: {
    subject: 'Assignment Declined',
    intro: (title) => `The assignee declined "${title}".`,
    accentColor: '#dc2626'
  },
  approved: {
    subject: 'Marketing Request Approved',
    intro: (title) => `Your marketing request "${title}" was approved and will be assigned shortly.`,
    accentColor: '#16a34a'
  },
  rejected: {
    subject: 'Marketing Request Declined',
    intro: (title) => `Your marketing request "${title}" was declined.`,
    accentColor: '#dc2626'
  },
  timeline_set: {
    subject: 'Delivery Timeline Committed',
    intro: (title) => `A delivery timeline was committed for your marketing request "${title}".`,
    accentColor: '#2563eb'
  },
  technical_review_assigned: {
    subject: 'Marketing Request Awaiting Your Technical Review',
    intro: (title) => `"${title}" was submitted for your technical review and verification.`,
    accentColor: '#2563eb'
  },
  technical_approved: {
    subject: 'Technical Team Approved Request',
    intro: (title) => `The Technical team approved "${title}". You can now complete final delivery.`,
    accentColor: '#16a34a'
  },
  technical_changes_requested: {
    subject: 'Technical Team Requested Changes',
    intro: (title) => `The Technical team requested changes on "${title}".`,
    accentColor: '#dc2626'
  },
  completed: {
    subject: 'Marketing Request Completed',
    intro: (title) => `Your marketing request "${title}" is ready and completed.`,
    accentColor: '#16a34a'
  },
  info_needed: {
    subject: 'Marketing Request Needs Your Input',
    intro: (title) => `Marketing is waiting for more information on "${title}".`,
    accentColor: '#dc2626'
  },
  priority_changed: {
    subject: 'Marketing Request Priority Raised',
    intro: (title) => `The priority of "${title}" was raised.`,
    accentColor: '#dc2626'
  },
  comment: {
    subject: 'New Comment on Marketing Request',
    intro: (title) => `A new comment was posted on "${title}".`,
    accentColor: '#2563eb'
  }
};

export function renderMarketingRequestLifecycleEmail(data: MarketingRequestLifecycleEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const copy = EVENT_COPY[data.event];
  const subject = `${copy.subject} — ${data.title}`;
  const intro = copy.intro(data.title);

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...(data.detail ? [data.detail, ''] : []),
    `View marketing requests: ${data.requestsUrl}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${data.detail ? renderInfoBox(`<p style="margin:0; font-size:14px; color:#111827;">${escapeHtml(data.detail)}</p>`) : ''}
                ${renderButton(data.requestsUrl, 'View Marketing Requests', copy.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
