import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listVisibleModules } from '@/lib/moduleConfigStore';
import { isProductManager } from '@/lib/productManagerStore';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { submitFeedback, findMyFeedback, ModuleFeedbackEntry } from '@/lib/feedbackStore';
import { isFeedbackWindowOpen, feedbackWindowLastDayLabel, feedbackDaysRemaining } from '@/lib/feedbackWindow';
import { apiErrorResponse } from '@/lib/apiError';

// Staff feedback on MatrixIQ itself.
//
// GET  — the questions THIS person should be asked (their own visible
//        modules), plus their previous answer if they already responded.
// POST — save/replace their answer, only while the window is open.
//
// Deliberately NOT under /api/admin/*: every member of staff answers this,
// and that prefix is gated on session.isPrivileged. Reading everyone's
// answers is the privileged action, and that lives on its own route
// (/api/admin/feedback) rather than being a branch of this one.

const MAX_TEXT = 4000;
const str = (v: unknown, limit = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, limit) : '');

function rating(v: unknown): number | null {
  const n = Number(v);
  // Null, not 0, when unanswered — a missing score must not read as "1 out
  // of 5" in the admin's averages.
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return Math.round(n);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // The questions are built from the modules this person can actually
    // reach, which is already role- and department-aware. That is what makes
    // the form specific to their work without a hand-maintained map of
    // department -> features that would drift the moment an admin changes
    // Module Manager.
    // Independent reads — the scope and the profile do not need each other.
    const [scope, profile] = await Promise.all([
      resolveVisibilityScope(viewer.username),
      findUserNameAndDeptByUsername(viewer.username)
    ]);
    const department = profile?.department ?? '';
    const designation = profile?.designation ?? '';

    const modules = await listVisibleModules({
      role: viewer.role,
      isPrivileged: viewer.isPrivileged,
      department,
      isDepartmentManager: !scope.seesOrgWide && !!scope.scopedUserIds && scope.scopedUserIds.length > 1,
      username: viewer.username,
      partnerId: viewer.partnerId ?? '',
      isProductManager: await isProductManager(viewer.userId)
    });

    const mine = await findMyFeedback(viewer.username);
    return NextResponse.json({
      open: isFeedbackWindowOpen(),
      lastDay: feedbackWindowLastDayLabel(),
      daysRemaining: feedbackDaysRemaining(),
      viewer: {
        name: viewer.name || viewer.username,
        role: viewer.role,
        department,
        designation
      },
      // The feedback module itself is not something to review.
      modules: modules
        .filter((m) => m.key !== 'feedback')
        .map((m) => ({ key: m.key, label: m.label, section: m.section, desc: m.desc })),
      existing: mine
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Enforced server-side, not only by hiding the tile: once the drive is
  // over a stale tab or a bookmarked URL must not still be able to post.
  if (!isFeedbackWindowOpen()) {
    return NextResponse.json(
      { error: `Feedback closed on ${feedbackWindowLastDayLabel()}. Thank you to everyone who responded.` },
      { status: 410 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const moduleFeedback: ModuleFeedbackEntry[] = Array.isArray(body.moduleFeedback)
      ? (body.moduleFeedback as unknown[])
          .map((raw) => {
            const m = raw as Record<string, unknown>;
            return {
              key: str(m.key, 80),
              label: str(m.label, 160),
              section: str(m.section, 80),
              rating: rating(m.rating),
              comment: str(m.comment, 2000)
            };
          })
          // Only keep what they actually answered — an untouched module is
          // not an opinion, and storing 40 blank rows per person would make
          // the admin screen unreadable.
          .filter((m) => m.key && (m.rating !== null || m.comment))
      : [];

    // Denormalised onto the response so it stays readable after someone
    // changes department or leaves.
    const profile = await findUserNameAndDeptByUsername(viewer.username);

    const saved = await submitFeedback({
      userId: viewer.userId,
      username: viewer.username,
      name: viewer.name || viewer.username,
      role: viewer.role,
      department: profile?.department ?? '',
      designation: profile?.designation ?? '',
      overallRating: rating(body.overallRating),
      overallComment: str(body.overallComment),
      moduleFeedback,
      worksWell: str(body.worksWell),
      slowsMeDown: str(body.slowsMeDown),
      missingFeatures: str(body.missingFeatures)
    });

    return NextResponse.json({ ok: true, submittedAt: saved.submittedAt });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
