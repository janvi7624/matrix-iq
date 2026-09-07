import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { list } from '@/lib/leaveRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { LeaveStatus } from '@/lib/types';

// Org-wide leave list for the HR module (HR + Admin + Super Admin only,
// via HR_RESTRICTED_KEYS) — distinct from GET /api/leave, which only
// returns the caller's own requests.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-leave'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const status = request.nextUrl.searchParams.get('status') as LeaveStatus | null;
  try {
    return NextResponse.json(await list({ status: status || undefined }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
