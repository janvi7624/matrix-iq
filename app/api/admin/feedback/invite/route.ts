import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listUsers } from '@/lib/userStore';
import { listPartnerUserIds } from '@/lib/partnerUserStore';
import { listAllFeedback } from '@/lib/feedbackStore';
import { sendEmail, isEmailConfigured } from '@/lib/email/emailService';
import { renderFeedbackInviteEmail } from '@/lib/email/templates/feedbackInvite';
import {
  FEEDBACK_ADMIN_ROLES,
  isFeedbackWindowOpen,
  feedbackWindowLastDayLabel,
  feedbackDaysRemaining
} from '@/lib/feedbackWindow';
import { apiErrorResponse } from '@/lib/apiError';

// Sends the feedback invitation.
//
// A route rather than a one-off script so the same path can send the first
// announcement and, later, a nudge to the people who have not replied
// (`onlyPending`). Admin-only on the same explicit role list as the
// responses themselves — this mails the whole company, which is not an
// action to leave on a role flag an admin can widen.
//
// `dryRun` returns exactly who WOULD be mailed, and renders one real subject
// line, without sending anything. Every send here is irreversible and lands
// in a colleague's inbox, so the list is reviewable before it goes.

const MAX_PER_RUN = 200;

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FEEDBACK_ADMIN_ROLES.includes(viewer.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    dryRun?: boolean;
    onlyPending?: boolean;
    exclude?: unknown;
  };
  const dryRun = body.dryRun !== false; // default to NOT sending
  const onlyPending = body.onlyPending === true;
  const exclude = new Set(
    (Array.isArray(body.exclude) ? body.exclude : []).filter((u): u is string => typeof u === 'string').map((u) => u.toLowerCase())
  );

  // Inviting people to a form that has closed would be worse than not
  // writing at all.
  if (!isFeedbackWindowOpen()) {
    return NextResponse.json(
      { error: `The feedback window closed on ${feedbackWindowLastDayLabel()} — not sending.` },
      { status: 410 }
    );
  }

  try {
    const [users, partnerIds, responses] = await Promise.all([
      listUsers(),
      listPartnerUserIds(),
      listAllFeedback()
    ]);
    const alreadyAnswered = new Set(responses.map((r) => r.username.toLowerCase()));

    const recipients = users
      .filter((u) => u.status === 'active')
      // Partner-portal accounts belong to another company. They were never
      // being asked, and a company-wide internal note must not reach them.
      .filter((u) => !partnerIds.has(u.id))
      .filter((u) => !!u.email && u.email.includes('@'))
      .filter((u) => !exclude.has(u.username.toLowerCase()))
      .filter((u) => !onlyPending || !alreadyAnswered.has(u.username.toLowerCase()));

    const lastDay = feedbackWindowLastDayLabel();
    const daysRemaining = feedbackDaysRemaining();
    const url = `${(process.env.APP_URL || '').replace(/\/+$/, '')}/feedback`;

    if (dryRun) {
      const sample = renderFeedbackInviteEmail({ name: recipients[0]?.name || 'there', lastDay, daysRemaining, url });
      return NextResponse.json({
        dryRun: true,
        emailConfigured: isEmailConfigured(),
        url,
        lastDay,
        daysRemaining,
        count: recipients.length,
        excluded: [...exclude],
        subject: sample.subject,
        recipients: recipients.map((u) => ({ username: u.username, name: u.name, email: u.email, department: u.department }))
      });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'Email is not configured on this server — nothing was sent.' }, { status: 503 });
    }
    if (recipients.length > MAX_PER_RUN) {
      return NextResponse.json({ error: `Refusing to send ${recipients.length} emails in one call.` }, { status: 400 });
    }

    // Sequential, one address per message. Not a single mail with everyone
    // in To/BCC: each is addressed to the person by name, and a bulk header
    // would expose the whole staff list to every recipient. A failure for
    // one person is recorded and the rest still go.
    const sent: string[] = [];
    const failed: { username: string; email: string; error: string }[] = [];
    for (const u of recipients) {
      const mail = renderFeedbackInviteEmail({ name: u.name || u.username, lastDay, daysRemaining, url });
      try {
        await sendEmail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text });
        sent.push(u.email);
      } catch (error) {
        failed.push({ username: u.username, email: u.email, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
      }
    }

    return NextResponse.json({ dryRun: false, sent: sent.length, failed: failed.length, failures: failed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
