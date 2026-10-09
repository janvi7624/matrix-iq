import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isMarketingManager } from '@/lib/permissions';
import { deleteFolder, findFolderById, FolderTreeError, updateFolder } from '@/lib/materialFolderStore';
import { apiErrorResponse } from '@/lib/apiError';

// Rename, re-describe, or move a folder. Moving is the operation with teeth —
// lib/materialFolderTree.ts refuses anything that would make a cycle or
// exceed the depth cap.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isMarketingManager(viewer))) {
    return NextResponse.json({ error: 'Only the Marketing team can edit folders.' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findFolderById(id);
    if (!existing) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });

    const patch: Parameters<typeof updateFolder>[1] = { actorId: viewer.userId };
    if (typeof body.name === 'string') patch.name = body.name;
    if (typeof body.description === 'string') patch.description = body.description.trim();
    // Present-but-null means "move to the top level", which is why this
    // checks for the key rather than for a truthy value.
    if ('parentId' in body) patch.parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;

    return NextResponse.json({ folder: await updateFolder(id, patch) });
  } catch (error) {
    if (error instanceof FolderTreeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isMarketingManager(viewer))) {
    return NextResponse.json({ error: 'Only the Marketing team can remove folders.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const existing = await findFolderById(id);
    if (!existing) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });

    // Refuses unless empty all the way down, and says what's in the way —
    // cascading would take a whole branch of the library with one click.
    await deleteFolder(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FolderTreeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
