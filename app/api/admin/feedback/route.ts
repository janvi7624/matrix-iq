import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { buildStaffFeedbackReport } from '@/lib/staffFeedbackReport';
import { apiErrorResponse } from '@/lib/apiError';
import { FEEDBACK_ADMIN_ROLES } from '@/lib/feedbackWindow';

// Every staff feedback response — admins here. The one other reader is the
// MatrixIQ product's Product Manager, through /api/product-manager/matrixiq-feedback
// (lib/staffFeedbackReport.ts) — that exception was asked for explicitly.
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
  // STRICTLY admin — not isPrivileged.
  //
  // isPrivileged is a flag on the ROLE, editable from Role Management, and
  // it is currently true for `manager` and `technical` as well as the admin
  // tier. Gating on it would hand three managers (and anyone a future admin
  // flips the flag for) every colleague's candid, named opinion of the
  // software and of their own work. An explicit role list is the right
  // shape here precisely BECAUSE it cannot be widened by a settings change
  // nobody connected to this screen.
  if (!FEEDBACK_ADMIN_ROLES.includes(viewer.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json(await buildStaffFeedbackReport());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
