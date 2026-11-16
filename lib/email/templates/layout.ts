// Shared chrome for every email template — the outer HTML shell (header bar,
// white card, footer) plus the small handful of inner building blocks
// (button, info box) every template composes differently. Centralizing this
// means a brand tweak (logo, colors, footer text) or an escaping fix is a
// one-file change instead of editing all ~10 templates identically.
import { BRAND } from '@/lib/branding';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Same escaping is safe inside a double-quoted HTML attribute as inside text
// content — kept as a distinct name at call sites for readability, not
// because the implementation differs.
export const escapeHtmlAttr = escapeHtml;

// bodyHtml is trusted, pre-built HTML — every value interpolated into it by
// a caller must already be escapeHtml()'d.
//
// accentColor lets an occasion-driven template (festival/celebration) tint
// the header's top accent bar and the "View in MatrixIQ" footer link to
// match the mail's own mood (e.g. gold for a festival, pink for a birthday)
// without every template re-implementing the shell. Defaults to the brand's
// own accent so every other template is unaffected.
export function renderEmailShell(subject: string, bodyHtml: string, logoUrl?: string, accentColor: string = BRAND.accentColor): string {
  const appName = BRAND.appName;
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#eef0f3; font-family:'Segoe UI', Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef0f3; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px; background-color:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 4px 16px rgba(17,24,39,0.10);">
            <tr>
              <td style="height:5px; background-color:${accentColor};"></td>
            </tr>
            <tr>
              <td style="background-color:${BRAND.themeColor}; background-image:linear-gradient(135deg, ${BRAND.themeColor} 0%, #1f2937 100%); padding:28px 32px; text-align:center;">
                ${logoUrl ? `<img src="${escapeHtmlAttr(logoUrl)}" alt="${escapeHtml(BRAND.companyName)}" height="34" style="height:34px; margin-bottom:10px;" />` : ''}
                <div style="color:#ffffff; font-size:20px; font-weight:700; letter-spacing:0.3px;">${escapeHtml(appName)}</div>
                <div style="color:#9ca3af; font-size:12px; margin-top:4px; letter-spacing:0.2px;">${escapeHtml(BRAND.tagline)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 22px; background-color:#f9fafb; border-top:1px solid #e5e7eb; text-align:center;">
                <p style="margin:0; font-size:12px; color:#9ca3af; line-height:1.6;">Regards,<br /><strong style="color:#6b7280;">${escapeHtml(appName)} Team</strong> &middot; ${escapeHtml(BRAND.companyLegalName)}</p>
                <p style="margin:10px 0 0; font-size:11px; color:#c3c8d1;">This is an automated message — please do not reply directly to this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

// A centered circular badge carrying one emoji, for the handful of
// occasion-driven templates (festival greetings, birthday/anniversary
// celebrations) that want a hero moment up top instead of diving straight
// into a paragraph of text.
export function renderHeroBadge(emoji: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
                  <tr>
                    <td style="width:72px; height:72px; border-radius:50%; background-color:${color}1a; text-align:center; vertical-align:middle; font-size:36px; line-height:72px;">${emoji}</td>
                  </tr>
                </table>`;
}

// A short, bold, centered headline under the hero badge — the "Happy
// Diwali!" / "It's Priya's birthday!" moment, distinct from the smaller body
// copy below it.
export function renderHeadline(text: string): string {
  return `<p style="margin:0 0 18px; font-size:22px; font-weight:700; color:#111827; text-align:center; line-height:1.3;">${escapeHtml(text)}</p>`;
}

// A quote-style callout for the main message — a left accent bar and tinted
// background instead of a bare paragraph, so the one sentence that matters
// (the greeting, the congratulations) actually reads as the point of the
// email rather than looking identical to incidental text around it.
export function renderQuoteBox(innerHtml: string, accentColor: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${accentColor}0d; border-left:4px solid ${accentColor}; border-radius:8px; margin:0 0 8px;">
                  <tr>
                    <td style="padding:18px 22px;">
                      ${innerHtml}
                    </td>
                  </tr>
                </table>`;
}

export function renderButton(url: string, label: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                  <tr>
                    <td style="border-radius:6px; background-color:${color};">
                      <a href="${escapeHtmlAttr(url)}" style="display:inline-block; padding:12px 28px; font-size:15px; color:#ffffff; text-decoration:none; font-weight:bold;">${escapeHtml(label)}</a>
                    </td>
                  </tr>
                </table>`;
}

// innerHtml is trusted, pre-escaped HTML (typically one or more <p> lines).
export function renderInfoBox(innerHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; margin-bottom:24px;">
                  <tr>
                    <td style="padding:16px 20px;">
                      ${innerHtml}
                    </td>
                  </tr>
                </table>`;
}

export function renderWarningBox(innerHtml: string, accentColor: string): string {
  return `<p style="margin:0; padding:12px 16px; background-color:#fef2f2; border-left:3px solid ${accentColor}; font-size:13px; color:#7f1d1d; line-height:1.5;">
                  ${innerHtml}
                </p>`;
}
