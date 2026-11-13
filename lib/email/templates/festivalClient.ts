import { BRAND } from '@/lib/branding';
import { escapeHtml, escapeHtmlAttr, RenderedEmail } from './layout';

// The CLIENT-facing festival greeting — deliberately separate from
// festival.ts (the internal staff greeting). It comes from the company, not
// from "the app": company logo and legal name, no MatrixIQ chrome, a
// festival-coloured header, Marketing's approved banner, and an unsubscribe
// footer (required for bulk mail and for staying out of spam folders).
//
// Table layout with inline styles only — the subset of HTML/CSS that renders
// the same in Gmail, Outlook and phone mail apps.

export interface FestivalClientEmailData {
  recipientName: string; // '' -> "Dear Valued Partner"
  company: string;
  festivalName: string;
  headline: string;
  message: string;
  bannerUrl: string; // absolute, public; '' -> coloured header only
  logoUrl: string; // absolute; '' -> company name as text
  unsubscribeUrl: string; // '' -> footer omits the link
  websiteUrl?: string;
}

interface Palette {
  primary: string;
  secondary: string;
  soft: string;
  emoji: string;
}

// Matched on the festival name, so HR adding "Diwali 2028" picks up the
// right colours without a code change. Anything unmatched gets the neutral
// gold palette.
const PALETTES: { match: RegExp; palette: Palette }[] = [
  { match: /diwali|deepavali|dhanteras/i, palette: { primary: '#b45309', secondary: '#f59e0b', soft: '#fff7ed', emoji: '🪔' } },
  { match: /holi/i, palette: { primary: '#be185d', secondary: '#8b5cf6', soft: '#fdf2f8', emoji: '🎨' } },
  { match: /christmas|xmas/i, palette: { primary: '#b91c1c', secondary: '#15803d', soft: '#fef2f2', emoji: '🎄' } },
  { match: /eid|bakrid|ramadan/i, palette: { primary: '#047857', secondary: '#ca8a04', soft: '#ecfdf5', emoji: '🌙' } },
  { match: /republic|independence|gandhi/i, palette: { primary: '#ea580c', secondary: '#15803d', soft: '#fff7ed', emoji: '🇮🇳' } },
  { match: /ganesh|ganpati/i, palette: { primary: '#c2410c', secondary: '#dc2626', soft: '#fff7ed', emoji: '🙏' } },
  { match: /new year|bestu|saal/i, palette: { primary: '#1d4ed8', secondary: '#ca8a04', soft: '#eff6ff', emoji: '✨' } },
  { match: /raksha|rakhi|bhai dooj/i, palette: { primary: '#c026d3', secondary: '#f59e0b', soft: '#fdf4ff', emoji: '🪢' } },
  { match: /dussehra|navratri|durga/i, palette: { primary: '#b91c1c', secondary: '#f59e0b', soft: '#fef2f2', emoji: '🏹' } }
];
const DEFAULT_PALETTE: Palette = { primary: '#92400e', secondary: '#d97706', soft: '#fffbeb', emoji: '🎉' };

export function festivalPalette(festivalName: string): Palette {
  return PALETTES.find((p) => p.match.test(festivalName))?.palette ?? DEFAULT_PALETTE;
}

function paragraphs(text: string, color: string): string {
  return text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px; font-size:15px; line-height:1.7; color:${color};">${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

export function renderFestivalClientEmail(data: FestivalClientEmailData): RenderedEmail {
  const palette = festivalPalette(data.festivalName);
  const company = BRAND.companyName;
  const legal = BRAND.companyLegalName;
  const subject = `${palette.emoji} ${data.headline || `Happy ${data.festivalName}`} — ${company}`;
  const salutation = data.recipientName ? `Dear ${data.recipientName},` : 'Dear Valued Partner,';
  const year = new Date().getFullYear();

  const banner = data.bannerUrl
    ? `<tr><td style="padding:0; line-height:0;"><img src="${escapeHtmlAttr(data.bannerUrl)}" alt="${escapeHtmlAttr(`${data.festivalName} greetings from ${company}`)}" width="600" style="display:block; width:100%; max-width:600px; height:auto; border:0;" /></td></tr>`
    : `<tr><td style="background:${palette.primary}; background-image:linear-gradient(135deg, ${palette.primary}, ${palette.secondary}); padding:48px 32px; text-align:center;">
         <div style="font-size:52px; line-height:1;">${palette.emoji}</div>
         <div style="margin-top:14px; font-family:Georgia, 'Times New Roman', serif; font-size:30px; font-weight:bold; color:#ffffff;">Happy ${escapeHtml(data.festivalName)}</div>
       </td></tr>`;

  const logo = data.logoUrl
    ? `<img src="${escapeHtmlAttr(data.logoUrl)}" alt="${escapeHtmlAttr(company)}" height="34" style="height:34px; border:0;" />`
    : `<span style="font-size:20px; font-weight:bold; letter-spacing:2px; color:#111827;">${escapeHtml(company)}</span>`;

  const unsubscribe = data.unsubscribeUrl
    ? `<p style="margin:10px 0 0; font-size:11px; color:#9ca3af;">You are receiving this because you are a valued client of ${escapeHtml(legal)}.<br /><a href="${escapeHtmlAttr(data.unsubscribeUrl)}" style="color:#6b7280; text-decoration:underline;">Unsubscribe from festival greetings</a></p>`
    : `<p style="margin:10px 0 0; font-size:11px; color:#9ca3af;">You are receiving this because you are a valued client of ${escapeHtml(legal)}.</p>`;

  const website = data.websiteUrl
    ? `<a href="${escapeHtmlAttr(data.websiteUrl)}" style="color:${palette.primary}; text-decoration:none; font-weight:bold;">${escapeHtml(data.websiteUrl.replace(/^https?:\/\//, ''))}</a>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:${palette.soft}; font-family:Arial, Helvetica, sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden;">${escapeHtml(data.headline)} — warm wishes from all of us at ${escapeHtml(company)}.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${palette.soft}; padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background-color:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,0.08);">
            <tr><td style="padding:20px 32px; text-align:center; border-bottom:3px solid ${palette.secondary};">${logo}</td></tr>
            ${banner}
            <tr>
              <td style="padding:36px 36px 12px;">
                <h1 style="margin:0 0 20px; font-family:Georgia, 'Times New Roman', serif; font-size:26px; line-height:1.3; color:${palette.primary}; text-align:center;">${escapeHtml(data.headline)}</h1>
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">${escapeHtml(salutation)}</p>
                ${paragraphs(data.message, '#374151')}
                <p style="margin:0 0 14px; font-size:15px; line-height:1.7; color:#374151;">Thank you for your continued trust and partnership. We look forward to growing together in the year ahead.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f3f4f6;">
                  <tr><td style="padding-top:20px;">
                    <p style="margin:0; font-size:15px; color:#111827;">Warm regards,</p>
                    <p style="margin:4px 0 0; font-size:16px; font-weight:bold; color:${palette.primary};">Team ${escapeHtml(company)}</p>
                    <p style="margin:2px 0 0; font-size:13px; color:#6b7280;">${escapeHtml(legal)}</p>
                  </td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color:#111827; padding:22px 32px; text-align:center;">
                <p style="margin:0; font-size:12px; color:#d1d5db;">${palette.emoji} Season's greetings from ${escapeHtml(legal)} ${palette.emoji}</p>
                ${website ? `<p style="margin:8px 0 0; font-size:12px;">${website}</p>` : ''}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
            <tr><td style="padding:16px 24px; text-align:center;">
              ${unsubscribe}
              <p style="margin:6px 0 0; font-size:11px; color:#9ca3af;">&copy; ${year} ${escapeHtml(legal)}</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    data.headline,
    '',
    salutation,
    '',
    data.message,
    '',
    'Thank you for your continued trust and partnership. We look forward to growing together in the year ahead.',
    '',
    'Warm regards,',
    `Team ${company}`,
    legal,
    ...(data.websiteUrl ? [data.websiteUrl] : []),
    '',
    ...(data.unsubscribeUrl ? [`Unsubscribe from festival greetings: ${data.unsubscribeUrl}`] : [])
  ].join('\n');

  return { subject, html, text };
}
