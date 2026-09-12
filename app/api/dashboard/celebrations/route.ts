import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { processTodaysCelebrations } from '@/lib/celebrationStore';
import { apiErrorResponse } from '@/lib/apiError';

// No cron/scheduler exists anywhere in this app — this GET is what actually
// triggers today's celebration emails, the first time ANY logged-in user's
// dashboard loads that day (processTodaysCelebrations() is idempotent per
// celebrant per day, so the 2nd/3rd/... dashboard load that day is a no-op
// beyond re-fetching the list for the popup).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const celebrations = await processTodaysCelebrations();
    return NextResponse.json({ celebrations });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
