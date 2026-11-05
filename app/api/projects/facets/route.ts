import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { projectStore, ProjectListQuery } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { ProjectStage, ProjectStatus } from '@/lib/types';

// The Sales Projects status-tile counts, the hidden-closed notice and the
// Total Value KPI — same query params as GET /api/projects (minus page/
// pageSize, which don't apply to an aggregate), kept as a separate route
// rather than folded into that one's response because components/
// ProjectsView.tsx needs this recomputed on every filter change but the
// page's own rows are a cheaper, more frequent fetch (pagination, sort)
// that this aggregate doesn't depend on.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const query: ProjectListQuery = {
      search: params.get('search') || undefined,
      stage: (params.get('stage') as ProjectStage) || undefined,
      status: (params.get('status') as ProjectStatus) || undefined,
      priority: params.get('priority') || undefined,
      salesPerson: params.get('salesPerson') || undefined,
      source: params.get('source') || undefined,
      department: params.get('department') || undefined,
      type: params.get('type') || undefined,
      lead: params.get('lead') || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      closingFrom: params.get('closingFrom') || undefined,
      closingTo: params.get('closingTo') || undefined,
      confirmation: params.get('confirmation') || undefined,
      awaitingMine: params.get('awaitingMine') === '1',
      awaitingTeam: params.get('awaitingTeam') === '1',
      includeClosed: params.get('includeClosed') === '1'
    };

    const facets = await projectStore.getFacets(viewer.username, viewer.userId, query);
    return NextResponse.json(facets);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
