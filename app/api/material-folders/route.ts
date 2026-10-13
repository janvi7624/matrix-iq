import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isMarketingManager } from '@/lib/permissions';
import { createFolder, listFolderTree, FolderTreeError } from '@/lib/materialFolderStore';
import { apiErrorResponse } from '@/lib/apiError';

// The whole folder tree — flat, with each folder's parent — so the client can
// render a breadcrumb or a move-to picker without a request per level.
// Readable by everyone: the folders ARE the navigation.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json({ folders: await listFolderTree(), canManage: await isMarketingManager(viewer) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Marketing-only, like every other write in this module.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isMarketingManager(viewer))) {
    return NextResponse.json({ error: 'Only the Marketing team can create folders.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const folder = await createFolder({
      name: typeof body.name === 'string' ? body.name : '',
      parentId: typeof body.parentId === 'string' && body.parentId ? body.parentId : null,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      actorId: viewer.userId
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    // Every tree rule failure is an explanation written for the person who
    // tried it — a 400 with that message, not a 500.
    if (error instanceof FolderTreeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
