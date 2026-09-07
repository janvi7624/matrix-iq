import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { generalTaskStore } from '@/lib/generalTaskStore';
import { apiErrorResponse } from '@/lib/apiError';

// Every task assigned to the viewer, admin- or hr-sourced alike — the
// unified inbox every employee gets regardless of who assigned the work.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const tasks = await generalTaskStore.listForAssignee(viewer.userId);
    return NextResponse.json(tasks);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
