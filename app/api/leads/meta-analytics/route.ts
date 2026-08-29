import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { computeMetaLeadAnalytics } from '@/lib/leadStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const analytics = await computeMetaLeadAnalytics(viewer.username, viewer.isPrivileged);
    return NextResponse.json(analytics);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
