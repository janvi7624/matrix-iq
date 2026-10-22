import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listActiveInternalEmployees } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

// Feeds the Delivery Challan "Requested By" picker — every active internal
// employee (excludes partner-admin/partner-user, see
// lib/userStore.ts's listActiveInternalEmployees). Deliberately a people-
// picker, not a write endpoint, so any authenticated user may call it —
// same gate as /api/users/lite, /api/marketing-roster, /api/technical-roster
// — the actual DC writes stay separately gated by isBackOfficeActor.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const employees = await listActiveInternalEmployees();
    return NextResponse.json(employees);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
