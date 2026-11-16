import { BRAND } from '@/lib/branding';
import { escapeHtml, renderEmailShell, renderHeadline, renderHeroBadge, renderQuoteBox, RenderedEmail } from './layout';

export interface FestivalEmailData {
  name: string; // this email's recipient — the greeting name
  festivalName: string;
  greeting: string;
}

// Gold/amber reads as "festival" across every occasion this sends for
// (Diwali, Eid, Christmas, ...) without needing a per-festival color map.
const FESTIVAL_ACCENT = '#d97706';

export function renderFestivalEmail(data: FestivalEmailData): RenderedEmail {
  const subject = `${data.festivalName} wishes from ${BRAND.companyName}!`;
  const text = [`Hello ${data.name},`, '', `Happy ${data.festivalName}!`, '', data.greeting, '', 'Regards,', `${BRAND.appName} Team`].join('\n');

  const bodyHtml = `
                ${renderHeroBadge('🎉', FESTIVAL_ACCENT)}
                ${renderHeadline(`Happy ${data.festivalName}, ${data.name}!`)}
                ${renderQuoteBox(
                  `<p style="margin:0; font-size:15px; color:#374151; line-height:1.6; text-align:center;">${escapeHtml(data.greeting)}</p>`,
                  FESTIVAL_ACCENT
                )}`;

  return { subject, html: renderEmailShell(subject, bodyHtml, undefined, FESTIVAL_ACCENT), text };
}
