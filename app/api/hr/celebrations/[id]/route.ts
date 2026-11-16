import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isCelebrationContributor, isHrManager } from '@/lib/hrAccess';
import { deleteCelebrationItem, findCelebrationItem, updateCelebrationItem } from '@/lib/companyCelebrationStore';

// Edit the caption of, or delete, one photo/video. The HR Manager may edit
// or delete ANY item (the wall is HR-curated). A department manager who is
// not HR may only edit/delete items THEY personally uploaded — see
// isCelebrationContributor's comment for why posting is open to every
// manager while structural control stays HR's.
async function canActOn(viewer: { username: string; userId: string; isPrivileged: boolean }, itemCreatedById: string): Promise<boolean> {
  if (await isHrManager(viewer)) return true;
  if (!(await isCelebrationContributor(viewer))) return false;
  return !!itemCreatedById && itemCreatedById === viewer.userId;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const existing = await findCelebrationItem(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!(await canActOn(viewer, existing.createdById))) {
      return NextResponse.json({ error: 'You can only edit an item you added yourself.' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

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
  const { id } = await params;

  try {
    const existing = await findCelebrationItem(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!(await canActOn(viewer, existing.createdById))) {
      return NextResponse.json({ error: 'You can only remove an item you added yourself.' }, { status: 403 });
    }

    const deleted = await deleteCelebrationItem(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
