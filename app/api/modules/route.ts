import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listVisibleModules } from '@/lib/moduleConfigStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user — this is what the Dashboard renders as tiles,
// scoped to modules that are enabled AND visible to the caller's role.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const modules = await listVisibleModules(viewer.role);
    return NextResponse.json(modules);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
