import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listProjectLeads } from '@/lib/projectLeadStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user — the fixed people a project's Lead / Mentor can be
// picked from (lib/projectLeadOptions.ts), for the create/edit forms and the
// Project Dashboard's Lead filter.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await listProjectLeads());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
