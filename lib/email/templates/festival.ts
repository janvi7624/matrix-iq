import { BRAND } from '@/lib/branding';
import { escapeHtml, renderEmailShell, RenderedEmail } from './layout';

export interface FestivalEmailData {
  name: string; // this email's recipient — the greeting name
  festivalName: string;
  greeting: string;
}

export function renderFestivalEmail(data: FestivalEmailData): RenderedEmail {
  const subject = `${data.festivalName} wishes from ${BRAND.companyName}!`;
  const text = [`Hello ${data.name},`, '', data.greeting, '', 'Regards,', `${BRAND.appName} Team`].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 8px; font-size:32px; text-align:center;">🎉</p>
                <p style="margin:0; font-size:15px; color:#374151; line-height:1.5; text-align:center;">${escapeHtml(data.greeting)}</p>`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
