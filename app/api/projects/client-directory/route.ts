import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { projectStore } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';

// id/client_name/company for every project the viewer can see — just enough
// for the New Project form's "did someone already enter this client" nudge
// (lib/clientSimilarity.ts) and Client Master's own lookup, both of which
// need the FULL set regardless of whatever page/filter the main Projects
// list is showing. Kept as its own lightweight route rather than piggy-
// backing on GET /api/projects so this one check doesn't force every other
// caller of that route to also decide whether it wants the unfiltered set.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const directory = await projectStore.listClientDirectory(viewer.username);
    return NextResponse.json(directory);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
