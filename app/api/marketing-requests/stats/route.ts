import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { apiErrorResponse } from '@/lib/apiError';

const OPEN_STATUSES = new Set(['submitted', 'timeline_set', 'in_progress']);

// Backs the Dashboard KPI card — reviewers get an org-wide "awaiting review"
// count (their queue), everyone else gets a count of their own open tickets.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const isReviewer = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'approve'));
    const records = await marketingRequestStore.list(viewer.username, isReviewer);

    if (isReviewer) {
      const awaitingReview = records.filter((r) => r.status === 'submitted').length;
      return NextResponse.json({ isReviewer: true, awaitingReview });
    }

    const myOpenCount = records.filter((r) => OPEN_STATUSES.has(r.status)).length;
    return NextResponse.json({ isReviewer: false, myOpenCount });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
