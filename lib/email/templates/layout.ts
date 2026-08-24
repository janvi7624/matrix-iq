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
export function renderEmailShell(subject: string, bodyHtml: string, logoUrl?: string): string {
  const appName = BRAND.appName;
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td style="background-color:${BRAND.themeColor}; padding:24px 32px; text-align:center;">
                ${logoUrl ? `<img src="${escapeHtmlAttr(logoUrl)}" alt="${escapeHtml(BRAND.companyName)}" height="36" style="height:36px; margin-bottom:4px;" />` : ''}
                <div style="color:#ffffff; font-size:18px; font-weight:bold; margin-top:${logoUrl ? '8px' : '0'};">${escapeHtml(appName)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f9fafb; border-top:1px solid #e5e7eb; text-align:center;">
                <p style="margin:0; font-size:12px; color:#9ca3af;">Regards,<br />${escapeHtml(appName)} Team &middot; ${escapeHtml(BRAND.companyLegalName)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
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
