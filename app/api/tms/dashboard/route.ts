import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { tmsTaskStore } from '@/lib/tmsTaskStore';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { tmsProcurementStore } from '@/lib/tmsProcurementStore';
import { apiErrorResponse } from '@/lib/apiError';

// Single round trip for the TMS Dashboard — returns the viewer-scoped raw
// lists (not just precomputed numbers), same "raw arrays included" pattern
// as app/api/dashboard/route.ts's allProjects/demos, so the client can
// re-filter by department/project/assignee/date/status without another
// round trip.
export async function GET(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-dashboard', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const [projects, tasks, bomRequests, procurements] = await Promise.all([
      tmsProjectStore.list(viewer),
      tmsTaskStore.list(viewer),
      tmsBomRequestStore.list(),
      tmsProcurementStore.list()
    ]);

    return NextResponse.json({ projects, tasks, bomRequests, procurements });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
