import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listForUser } from '@/lib/attendanceStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated employee's own attendance history — read-only, no HR
// gate needed since it's scoped to viewer.userId only, never another
// employee's record.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from and to dates are required' }, { status: 400 });

  try {
    return NextResponse.json(await listForUser(viewer.userId, from, to));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
