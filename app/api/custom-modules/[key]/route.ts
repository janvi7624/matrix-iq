import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getModuleForViewer } from '@/lib/customModuleStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user whose role the module is visible to — this is what
// the generic engine (app/modules/[key]) fetches to know what fields/
// approval rules to render. Real enforcement (not just a dashboard-display
// concern) since this route sits outside /api/admin.
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { key } = await params;
    const module_ = await getModuleForViewer(key, viewer);
    if (!module_) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    return NextResponse.json(module_);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
