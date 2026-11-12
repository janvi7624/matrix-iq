import { BRAND } from '@/lib/branding';
import { escapeHtml, renderEmailShell, RenderedEmail } from './layout';

export interface FeedbackInviteData {
  /** The recipient's own name — addressed to one person, not to a list. */
  name: string;
  /** "18 November 2026" */
  lastDay: string;
  daysRemaining: number;
  /** Absolute URL to the form. */
  url: string;
}

/**
 * The one announcement for the feedback drive.
 *
 * Deliberately plain and short. It asks busy people for a favour, so it says
 * what it wants, roughly how long it takes, how long they have and where the
 * answers go — and nothing else. No marketing voice, no manufactured urgency.
 *
 * It states up front that responses carry their name and go to the admin
 * team. Someone deciding how candid to be is entitled to know that before
 * they write, not after.
 */
export function renderFeedbackInviteEmail(data: FeedbackInviteData): RenderedEmail {
  const appName = BRAND.appName;
  const subject = `Your feedback on ${appName} — open until ${data.lastDay}`;
  const closing = data.daysRemaining === 1 ? 'today is the last day' : `about ${data.daysRemaining} days left`;

  const text = [
    `Hello ${data.name},`,
    '',
    `We'd like to hear how ${appName} is actually working for you — what helps, what gets in the way, and what's missing from the parts you use day to day.`,
    '',
    `The form only asks about the areas that belong to your role and department, so it should take a few minutes. Every question is optional, and you can go back and change your answers while it's open.`,
    '',
    data.url,
    '',
    `This is a short collection, not a permanent form — it closes on ${data.lastDay} (${closing}) and disappears after that.`,
    '',
    'Your answers go to the admin team only, with your name attached so they can come back to you if something needs clarifying. Candid is more useful than polite.',
    '',
    'Thank you.',
    '',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 14px; font-size:15px; color:#374151; line-height:1.6;">
                  We&rsquo;d like to hear how ${escapeHtml(appName)} is actually working for you — what helps, what gets
                  in the way, and what&rsquo;s missing from the parts you use day to day.
                </p>
                <p style="margin:0 0 14px; font-size:15px; color:#374151; line-height:1.6;">
                  The form only asks about the areas that belong to your role and department, so it should take a few
                  minutes. Every question is optional, and you can go back and change your answers while it&rsquo;s open.
                </p>
                <p style="margin:24px 0; text-align:center;">
                  <a href="${escapeHtml(data.url)}" style="background:#C8102E; color:#ffffff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600; display:inline-block; font-size:15px;">Share your feedback</a>
                </p>
                <p style="margin:0 0 14px; font-size:15px; color:#374151; line-height:1.6;">
                  This is a short collection, not a permanent form — it closes on
                  <strong>${escapeHtml(data.lastDay)}</strong> (${escapeHtml(closing)}) and disappears after that.
                </p>
                <p style="margin:0 0 14px; font-size:13px; color:#64748b; line-height:1.6;">
                  Your answers go to the admin team only, with your name attached so they can come back to you if
                  something needs clarifying. Candid is more useful than polite.
                </p>
                <p style="margin:0; font-size:15px; color:#374151;">Thank you.</p>`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
