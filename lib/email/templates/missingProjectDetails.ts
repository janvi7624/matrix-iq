import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

// A nudge to the owner of a project whose mandatory fields are still blank.
// Deliberately not worded as an accusation: most of these blanks exist because
// the fields themselves are newer than the rows (approx. price shipped
// 2026-09-14, opportunity type 2026-09-28, department 2026-09-29), so every
// project created before those dates started life incomplete through nobody's
// fault. People act on a list that explains itself; they ignore one that reads
// like a telling-off.
export interface MissingProjectDetailsEmailData {
  name: string;
  items: { kind: 'Sales' | 'TMS'; label: string; missing: string[] }[];
  projectsUrl: string;
  tmsUrl: string;
}

// A safety valve, not an expected path — the biggest real list today is 26, so
// everyone currently gets theirs in full. A list long enough to trip this is a
// sign the dashboard is the better place to work from anyway.
const MAX_LISTED = 30;

export function renderMissingProjectDetailsEmail(data: MissingProjectDetailsEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const n = data.items.length;
  const hasSales = data.items.some((i) => i.kind === 'Sales');
  const hasTms = data.items.some((i) => i.kind === 'TMS');

  const subject = `Please complete ${n === 1 ? '1 project' : `${n} projects`} missing required details`;

  const intro =
    `${n === 1 ? 'One project you own is' : `${n} projects you own are`} missing details that ${appName} now requires. ` +
    'Most of these are blank only because the fields were added to the system after the project was created — ' +
    'nothing was done wrong, they just need filling in once. ' +
    'Until they are filled, these projects are left out of department reporting and pipeline value.';

  const shown = data.items.slice(0, MAX_LISTED);
  const lines = shown.map((i) => `${hasSales && hasTms ? `[${i.kind}] ` : ''}${i.label} — missing: ${i.missing.join(', ')}`);
  if (data.items.length > shown.length) {
    lines.push(`…and ${data.items.length - shown.length} more (all of them are listed on your dashboard).`);
  }

  // One primary button for the common single-module case; both links spelled
  // out when someone owns work on each side, so neither is a dead end.
  const primaryUrl = hasSales ? data.projectsUrl : data.tmsUrl;
  const primaryLabel = hasSales ? 'Open Project Dashboard' : 'Open TMS Projects';
  const secondary = hasSales && hasTms ? data.tmsUrl : '';

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...lines,
    '',
    `${primaryLabel}: ${primaryUrl}`,
    ...(secondary ? [`Open TMS Projects: ${secondary}`] : []),
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${renderInfoBox(lines.map((line) => `<p style="margin:0 0 8px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`).join(''))}
                ${renderButton(primaryUrl, primaryLabel, '#2563eb')}
                ${secondary ? `<p style="margin:16px 0 0; font-size:14px; color:#374151; text-align:center;">Your TMS projects are here: <a href="${escapeHtml(secondary)}" style="color:#2563eb;">${escapeHtml(secondary)}</a></p>` : ''}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
