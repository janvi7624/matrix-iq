import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isHrManager } from '@/lib/hrAccess';
import { deleteCelebrationItem, updateCelebrationItem } from '@/lib/companyCelebrationStore';

// Edit the caption of, or delete, one photo/video. HR Manager, admin, superadmin.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Only the HR Manager can edit the Company Celebration wall.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { id } = await params;
  try {
    const item = await updateCelebrationItem(id, {
      title: typeof body.title === 'string' ? body.title : undefined,
      description: typeof body.description === 'string' ? body.description : undefined
    });
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Only the HR Manager can remove items from the Company Celebration wall.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const deleted = await deleteCelebrationItem(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
