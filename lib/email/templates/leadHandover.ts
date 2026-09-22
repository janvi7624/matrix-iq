import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export interface LeadHandoverEmailData {
  name: string;
  capturedBy: string;
  capturedAt: string;
  contactName: string;
  designation: string;
  company: string;
  mobile: string;
  contactEmail: string;
  city: string;
  priority: string;
  interests: string[];
  subInterests: string[];
  followUpActions: string[];
  budget: string;
  notes: string;
  hasCardImage: boolean;
  leadsUrl: string;
}

// Lead Capture's hand-over (lib/leadHandover.ts): a colleague scanned a card
// that belongs to this person and passed the lead to them. Carries the
// contact's details so they can call back straight from the email; the
// scanned card itself stays behind the app's login, so it's only mentioned.
export function renderLeadHandoverEmail(data: LeadHandoverEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const label = data.contactName || data.company || 'a new contact';
  const subject = `Lead handed over to you — ${data.contactName && data.company ? `${data.contactName}, ${data.company}` : label}`;
  const intro = `${data.capturedBy} captured a lead that belongs to you and has handed it over to you. It's now in your Lead Capture list under "Assigned To Me".`;

  const contactLines = [
    ['Contact', data.contactName],
    ['Designation', data.designation],
    ['Company', data.company],
    ['Mobile', data.mobile],
    ['Email', data.contactEmail],
    ['City', data.city]
  ].filter(([, value]) => value);

  const qualificationLines = [
    ['Priority', data.priority],
    ['Interested in', data.interests.join(', ')],
    ['Specifics', data.subInterests.join(', ')],
    ['Follow-up', data.followUpActions.join(', ')],
    ['Budget', data.budget],
    ['Notes', data.notes]
  ].filter(([, value]) => value);

  const captureLines = [
    ['Captured by', data.capturedBy],
    ['Captured on', data.capturedAt],
    ...(data.hasCardImage ? [['Business card', 'Photo attached to the lead in the app']] : [])
  ];

  const allLines = [...contactLines, ...qualificationLines, ...captureLines];
  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...allLines.map(([key, value]) => `${key}: ${value}`),
    '',
    `Open your leads: ${data.leadsUrl}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const renderLines = (lines: string[][]) =>
    lines.map(([key, value]) => `<p style="margin:0 0 6px; font-size:14px; color:#111827;"><strong style="color:#374151;">${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`).join('');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${renderInfoBox(renderLines(contactLines.length ? contactLines : [['Contact', label]]))}
                ${renderInfoBox(renderLines([...qualificationLines, ...captureLines]))}
                ${renderButton(data.leadsUrl, 'Open My Leads', '#2563eb')}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
