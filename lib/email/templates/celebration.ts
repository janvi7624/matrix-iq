import { BRAND } from '@/lib/branding';
import { escapeHtml, renderEmailShell, renderHeadline, renderHeroBadge, renderQuoteBox, RenderedEmail } from './layout';

export type CelebrationType = 'birthday' | 'anniversary';
// 'personal' = sent to the celebrant themselves; 'announcement' = sent to
// every other active teammate.
export type CelebrationAudience = 'personal' | 'announcement';

export interface CelebrationEmailData {
  name: string; // this email's recipient — the greeting name
  celebrantName: string;
  type: CelebrationType;
  audience: CelebrationAudience;
  years?: number; // anniversary only
}

// Pink for a birthday, gold for a work anniversary — distinct enough that
// the two occasions don't read as the same template with different words.
const CELEBRATION_ACCENT: Record<CelebrationType, string> = { birthday: '#db2777', anniversary: '#b45309' };

export function renderCelebrationEmail(data: CelebrationEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const isBirthday = data.type === 'birthday';
  const isPersonal = data.audience === 'personal';
  const accent = CELEBRATION_ACCENT[data.type];
  const yearsLabel = `${data.years} year${data.years === 1 ? '' : 's'}`;

  const subject = isPersonal
    ? (isBirthday ? `Happy Birthday, ${data.celebrantName}!` : `Happy Work Anniversary, ${data.celebrantName}!`)
    : (isBirthday ? `It's ${data.celebrantName}'s birthday today!` : `${data.celebrantName} completes ${yearsLabel} with us today!`);

  const headline = isPersonal
    ? (isBirthday ? `Happy Birthday, ${data.celebrantName}!` : `Happy Work Anniversary, ${data.celebrantName}!`)
    : (isBirthday ? `It's ${data.celebrantName}'s birthday today!` : `${data.celebrantName} completes ${yearsLabel} today!`);

  const intro = isPersonal
    ? (isBirthday
      ? `Wishing you a very happy birthday! Everyone at ${BRAND.companyName} hopes you have a wonderful day.`
      : `Congratulations on completing ${yearsLabel} with ${BRAND.companyName}! Thank you for everything you've contributed — here's to many more.`)
    : (isBirthday
      ? `Today is ${data.celebrantName}'s birthday. Take a moment to wish them well!`
      : `Today, ${data.celebrantName} completes ${yearsLabel} with ${BRAND.companyName}. Join us in congratulating them!`);

  const text = [`Hello ${data.name},`, '', headline, '', intro, '', 'Regards,', `${appName} Team`].join('\n');

  const bodyHtml = `
                ${renderHeroBadge(isBirthday ? '🎂' : '🏆', accent)}
                ${renderHeadline(headline)}
                <p style="margin:0 0 16px; font-size:15px; color:#111827; text-align:center;">Hello ${escapeHtml(data.name)},</p>
                ${renderQuoteBox(
                  `<p style="margin:0; font-size:15px; color:#374151; line-height:1.6; text-align:center;">${escapeHtml(intro)}</p>`,
                  accent
                )}`;

  return { subject, html: renderEmailShell(subject, bodyHtml, undefined, accent), text };
}
