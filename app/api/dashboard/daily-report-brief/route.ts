import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { hasCapability } from '@/lib/permissions';
import { buildDailyReportAdminBrief } from '@/lib/dailyReportService';
import { apiErrorResponse } from '@/lib/apiError';

// The dashboard half of "mail and in dashboard both" — see
// buildDailyReportAdminBrief in lib/dailyReportService.ts for the actual
// computation, shared with app/api/dashboard/route.ts's combined payload.
// Kept as its own endpoint for any direct caller; Dashboard.tsx itself now
// reads this off /api/dashboard instead of calling here separately.
//
// Gated on the viewAllDepartments CAPABILITY, not on the one named
// username the email goes to — see the function's own doc comment.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await hasCapability(viewer.role, 'viewAllDepartments'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json(await buildDailyReportAdminBrief());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
