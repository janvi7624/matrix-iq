import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findDepartmentById, listDepartmentManagers } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';

// Backs Task Planner's "Assign To -> Department -> Department Manager"
// confirmation preview (who exactly will this task land on) — mirrors
// active-employees/route.ts's own precedent exactly (any authenticated
// viewer may call this; the real assignment permission is enforced on the
// create route, not here).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const department = await findDepartmentById(id);
    if (!department) return NextResponse.json([]);
    const managers = (await listDepartmentManagers())[department.name] || [];
    return NextResponse.json(managers);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
