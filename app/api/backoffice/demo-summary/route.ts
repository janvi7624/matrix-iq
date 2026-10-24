import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isBackOfficeActor } from '@/lib/backOfficeAccess';
import { getBackOfficeDemoSummary } from '@/lib/backOfficeDemoSummary';
import { apiErrorResponse } from '@/lib/apiError';

// "Which sales person did how many demos (DCs), and what did they cost" —
// same gate as every other Delivery Challan action (lib/backOfficeAccess.ts),
// so a Back Office department manager sees this even on a non-'backoffice'
// login role, exactly like the DC edit/view routes already do.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isBackOfficeActor(viewer))) {
    return NextResponse.json({ error: 'Forbidden — Back Office only' }, { status: 403 });
  }

  try {
    const period = request.nextUrl.searchParams.get('period') || 'this_month';
    const report = await getBackOfficeDemoSummary({ period });
    return NextResponse.json(report);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
