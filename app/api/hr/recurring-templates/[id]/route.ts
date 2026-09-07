import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule, isHrManager } from '@/lib/hrAccess';
import { setTemplateActive } from '@/lib/hrRecurringTaskStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-settings')) || !(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.active !== 'boolean') return NextResponse.json({ error: 'A boolean "active" field is required' }, { status: 400 });

  try {
    const updated = await setTemplateActive(id, body.active);
    if (!updated) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
