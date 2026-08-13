import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user — {departmentName: [{id, username, name}]}. Used
// both for "this request will need approval from <name>" hint text and the
// Dashboard's "awaiting your approval" matching (is the viewer a manager of
// the assigned person's department).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listDepartmentManagers());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
