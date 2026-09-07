import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { generalTaskStore } from '@/lib/generalTaskStore';
import { GeneralTaskSourceModule } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

// Generic listing, scoped to the viewer's own visibility — used by the HR
// task workspace (?sourceModule=hr) and any org-wide reporting view.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sourceModuleParam = request.nextUrl.searchParams.get('sourceModule');
  const sourceModule: GeneralTaskSourceModule | undefined = sourceModuleParam === 'admin' || sourceModuleParam === 'hr' ? sourceModuleParam : undefined;

  try {
    const tasks = await generalTaskStore.list(viewer, { sourceModule });
    return NextResponse.json(tasks);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
