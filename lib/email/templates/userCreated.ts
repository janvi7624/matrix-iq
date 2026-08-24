import { BRAND } from '@/lib/branding';
import { escapeHtml, escapeHtmlAttr, renderButton, renderEmailShell, renderInfoBox, renderWarningBox, RenderedEmail } from './layout';

export interface UserCreatedEmailData {
  name: string;
  username: string;
  email: string;
  password: string;
  loginUrl: string;
}

export function renderUserCreatedEmail(data: UserCreatedEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const subject = `Welcome to ${appName} – Your Account Details`;
  const logoUrl = data.loginUrl ? new URL(BRAND.logo, data.loginUrl).toString() : '';

  const text = [
    `Hello ${data.name},`,
    '',
    `Your account has been successfully created on ${appName}.`,
    '',
    'Login Details:',
    `Email/Username: ${data.username}`,
    `Password: ${data.password}`,
    '',
    'Login here:',
    data.loginUrl,
    '',
    'For security reasons, please change your password after your first login.',
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">
                  Your account has been successfully created on <strong>${escapeHtml(appName)}</strong>. Use the credentials below to log in.
                </p>
                ${renderInfoBox(`
                      <p style="margin:0 0 8px; font-size:14px; color:#6b7280;">Email / Username</p>
                      <p style="margin:0 0 16px; font-size:15px; color:#111827; font-weight:bold;">${escapeHtml(data.username)}</p>
                      <p style="margin:0 0 8px; font-size:14px; color:#6b7280;">Temporary Password</p>
                      <p style="margin:0; font-size:15px; color:#111827; font-weight:bold; font-family:'Courier New', monospace;">${escapeHtml(data.password)}</p>`)}
                ${renderButton(data.loginUrl, `Log in to ${appName}`, BRAND.accentColor)}
                <p style="margin:16px 0 8px; font-size:13px; color:#6b7280; line-height:1.5;">
                  If the button above doesn't work, copy and paste this link into your browser:<br />
                  <a href="${escapeHtmlAttr(data.loginUrl)}" style="color:${BRAND.accentColor};">${escapeHtml(data.loginUrl)}</a>
                </p>
                ${renderWarningBox('For security reasons, please change your password immediately after your first login.', BRAND.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml, logoUrl), text };
}
