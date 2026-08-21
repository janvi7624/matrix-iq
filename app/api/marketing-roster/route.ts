import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listMarketingRoster } from '@/lib/marketingRoster';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user — feeds the people-picker for "Marketing Assignee"
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listMarketingRoster());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
