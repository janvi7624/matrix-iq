import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { pickableEmployees } from '@/lib/appreciationAccess';

// The employees the caller may appreciate — their department(s) and direct
// reports, or everyone for admin / superadmin. Empty for anyone else.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await pickableEmployees(viewer));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
