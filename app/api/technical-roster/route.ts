import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listTechnicalRoster } from '@/lib/technicalRoster';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user — feeds the real people-picker for "assigned
// technical person" on Demo Schedule and Projects.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listTechnicalRoster());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
