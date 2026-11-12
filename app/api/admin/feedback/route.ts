import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listAllFeedback } from '@/lib/feedbackStore';
import { isFeedbackWindowOpen, feedbackWindowLastDayLabel, feedbackDaysRemaining } from '@/lib/feedbackWindow';
import { listUsers } from '@/lib/userStore';
import { listPartnerUserIds } from '@/lib/partnerUserStore';
import { apiErrorResponse } from '@/lib/apiError';

// Every staff feedback response — ADMIN ONLY, as asked.
//
// Under /api/admin/* deliberately: that prefix is already blanket-gated on
// session.isPrivileged in proxy.ts, so this inherits the same wall the rest
// of the admin area sits behind. The explicit isPrivileged check below is
// belt and braces — this route exposes named colleagues' candid opinions of
// the software and of the work, and that is not something to leave resting
// on one layer.
//
// Note this route does NOT check the window: an admin must still be able to
// read the answers after collection closes. Closing the drive stops new
// submissions; it does not retract what people said.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!viewer.isPrivileged) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const responses = await listAllFeedback();

    // "14 of 85 replied" is the number an admin actually wants while the
    // drive is running — a count on its own says nothing about take-up.
    // Partner-portal accounts are external to the company and were never
    // asked, so they must not sit in the denominator. UserRecord carries no
    // partnerId, so the set comes from partnerUserStore.
    const [users, partnerIds] = await Promise.all([listUsers(), listPartnerUserIds()]);
    const eligible = users.filter((u) => u.status === 'active' && !partnerIds.has(u.id));
    const respondedUsernames = new Set(responses.map((r) => r.username));

    return NextResponse.json({
      open: isFeedbackWindowOpen(),
      lastDay: feedbackWindowLastDayLabel(),
      daysRemaining: feedbackDaysRemaining(),
      total: responses.length,
      eligible: eligible.length,
      // Who has not answered yet, so a nudge can go to the right people
      // rather than to everyone again.
      pending: eligible
        .filter((u) => !respondedUsernames.has(u.username))
        .map((u) => ({ username: u.username, name: u.name, department: u.department }))
        .sort((a, b) => (a.department || '').localeCompare(b.department || '') || a.name.localeCompare(b.name)),
      responses
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
