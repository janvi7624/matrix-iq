import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { findSoldTmsProjectForViewer } from '@/lib/tmsSalesVisibility';
import { tmsTaskStore } from '@/lib/tmsTaskStore';
import { apiErrorResponse } from '@/lib/apiError';

// One sold project's read-only detail + its full task list. Row-level, not
// just the module gate: findSoldTmsProjectForViewer re-checks
// sales_person_username against this viewer's own scope, so knowing a
// project's id is never enough on its own — same defense-in-depth every
// other single-record TMS/Sales route in this app already has.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('my-sold-projects', viewer))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const project = await findSoldTmsProjectForViewer(viewer.username, id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const tasks = await tmsTaskStore.listForProject(project.id);
    return NextResponse.json({ project, tasks });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
