import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { computeLeadStats } from '@/lib/leadStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const stats = await computeLeadStats(viewer.username, viewer.isPrivileged);
    return NextResponse.json(stats);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
