import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, renderWarningBox, RenderedEmail } from './layout';

export interface PasswordChangedEmailData {
  name: string;
  username: string;
  loginUrl: string;
  // 'self' = the user changed their own password (self-service) — the new
  // value is never included, since they already know it and email is not a
  // secure channel to re-send it over. 'admin' = an administrator reset it
  // for them, so newPassword must be set — they have no other way to know it.
  initiatedBy: 'self' | 'admin';
  newPassword?: string;
}

export function renderPasswordChangedEmail(data: PasswordChangedEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const isAdminReset = data.initiatedBy === 'admin';
  // Wording here is deliberately low-key (no "reset"/"changed" alarm words,
  // no urgency) for the admin-provisioned case — it's routine, expected
  // account provisioning, not a security event, and this content sits right
  // next to a plaintext password + login button, which mail-security content
  // filters already treat as a credential-phishing signal on its own. Piling
  // on urgent/alarming language made that worse in practice (see the "some
  // recipients never received it despite clean SPF/DKIM/DMARC" investigation
  // — a plain test send delivered fine, this template didn't).
  const subject = isAdminReset ? `Your ${appName} Login Details` : `Your ${appName} Password Was Changed`;

  const intro = isAdminReset
    ? `An administrator has set up your login for ${appName}. Your credentials are below.`
    : `Your password on ${appName} was just changed. If you made this change, no further action is needed.`;

  const securityNote = isAdminReset
    ? 'We recommend updating this password the next time you log in.'
    : "If you did not make this change, please contact your administrator — your account's security may be at risk.";

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...(isAdminReset
      ? [`Email/Username: ${data.username}`, `Temporary Password: ${data.newPassword ?? ''}`, '', 'Login here:', data.loginUrl, '']
      : []),
    securityNote,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${
                  isAdminReset
                    ? `${renderInfoBox(`
                      <p style="margin:0 0 8px; font-size:14px; color:#6b7280;">Email / Username</p>
                      <p style="margin:0 0 16px; font-size:15px; color:#111827; font-weight:bold;">${escapeHtml(data.username)}</p>
                      <p style="margin:0 0 8px; font-size:14px; color:#6b7280;">Temporary Password</p>
                      <p style="margin:0; font-size:15px; color:#111827; font-weight:bold; font-family:'Courier New', monospace;">${escapeHtml(data.newPassword ?? '')}</p>`)}
                ${renderButton(data.loginUrl, `Log in to ${appName}`, BRAND.accentColor)}
                <p style="margin:16px 0 0; font-size:13px; color:#6b7280; line-height:1.5;">${escapeHtml(securityNote)}</p>`
                    : renderWarningBox(escapeHtml(securityNote), BRAND.accentColor)
                }`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
