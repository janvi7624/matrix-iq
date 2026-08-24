import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export interface AccountChangedEmailData {
  name: string;
  loginUrl: string;
  // Only the fields that actually changed are set — the template renders
  // exactly one line per changed field, in one email, however many changed
  // in the same admin edit.
  newRole?: string;
  newDepartment?: string;
  newStatus?: 'active' | 'inactive';
}

export function renderAccountChangedEmail(data: AccountChangedEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const onlyStatusChanged = data.newStatus !== undefined && data.newRole === undefined && data.newDepartment === undefined;
  const deactivated = onlyStatusChanged && data.newStatus === 'inactive';
  const reactivated = onlyStatusChanged && data.newStatus === 'active';

  const subject = deactivated
    ? `Your ${appName} Account Has Been Deactivated`
    : reactivated
      ? `Your ${appName} Account Has Been Reactivated`
      : `Your ${appName} Account Has Been Updated`;

  const changeLines: string[] = [];
  if (data.newRole) changeLines.push(`Role: ${data.newRole}`);
  if (data.newDepartment !== undefined) changeLines.push(`Department: ${data.newDepartment || 'Unassigned'}`);
  if (data.newStatus) changeLines.push(`Account status: ${data.newStatus === 'active' ? 'Active' : 'Inactive'}`);

  const intro = deactivated
    ? `Your account on ${appName} has been deactivated. You will not be able to log in until it is reactivated by an administrator.`
    : reactivated
      ? `Your account on ${appName} has been reactivated. You can log in again using your existing credentials.`
      : `The following changes were made to your account on ${appName}:`;

  const showLoginCta = !deactivated;

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...(changeLines.length && !onlyStatusChanged ? [...changeLines, ''] : []),
    ...(showLoginCta ? [`Log in here: ${data.loginUrl}`, ''] : []),
    'If you have any questions about this change, please contact your administrator.',
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${
                  changeLines.length && !onlyStatusChanged
                    ? renderInfoBox(changeLines.map((line) => `<p style="margin:0 0 8px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`).join(''))
                    : ''
                }
                ${showLoginCta ? renderButton(data.loginUrl, `Log in to ${appName}`, BRAND.accentColor) : ''}
                <p style="margin:16px 0 0; font-size:13px; color:#6b7280; line-height:1.5;">
                  If you have any questions about this change, please contact your administrator.
                </p>`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
