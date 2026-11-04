import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getUpcomingCelebrations } from '@/lib/celebrationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Upcoming birthdays/anniversaries — see getUpcomingCelebrations in
// lib/celebrationStore.ts for the actual computation, shared with
// app/api/dashboard/route.ts's combined payload. Kept as its own endpoint
// for any direct caller; Dashboard.tsx itself now reads this off
// /api/dashboard instead of calling here separately.
//
// Despite the name, never HR-restricted — any signed-in viewer may call it.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await getUpcomingCelebrations());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
