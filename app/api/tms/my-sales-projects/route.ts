import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { listTmsProjectsSoldBy } from '@/lib/tmsSalesVisibility';
import { apiErrorResponse } from '@/lib/apiError';

// The Sales side's "My Sold Projects" — read-only, scoped to deals THIS
// viewer sold (or their whole team's if they manage Sales). Deliberately
// outside app/api/tms/** proper: those all resolve a TmsViewer
// (lib/tmsAccess.ts), which requires TMS department/role membership a sales
// account never has. See lib/tmsSalesVisibility.ts for the scoping rule.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('my-sold-projects', viewer))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const projects = await listTmsProjectsSoldBy(viewer.username);
    return NextResponse.json({ projects });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
