import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { buildMyTargetSummary } from '@/lib/myTargetSummary';
import { apiErrorResponse } from '@/lib/apiError';

// The viewer's OWN target and achievement, for the Dashboard panel — see
// buildMyTargetSummary in lib/myTargetSummary.ts for the actual
// computation, shared with app/api/dashboard/route.ts's combined payload.
// Kept as its own endpoint for any direct caller; Dashboard.tsx itself now
// reads this off /api/dashboard instead of calling here separately.
//
// No canManageTargets gate: that permission is about setting other people's
// targets, and a rep being unable to see their own number would be absurd.
// The employee id is taken from the session, never from the query string, so
// this endpoint cannot be pointed at a colleague.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await buildMyTargetSummary(viewer.userId, viewer.username));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
