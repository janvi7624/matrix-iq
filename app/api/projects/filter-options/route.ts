import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { projectStore } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';

// The Sales Person / Source filter dropdowns' option lists — unfiltered, the
// viewer's whole visible set, same as components/ProjectsView.tsx used to
// derive from the full in-browser projects array before pagination existed.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const options = await projectStore.listFilterOptions(viewer.username);
    return NextResponse.json(options);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
