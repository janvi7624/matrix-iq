import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isMarketingManager } from '@/lib/permissions';
import { isMaterialCategory } from '@/lib/materialCategories';
import { parseDriveLink } from '@/lib/driveLink';
import { deleteMaterial, findMaterialById, MaterialPatch, updateMaterial } from '@/lib/materialStore';
import { findFolderById } from '@/lib/materialFolderStore';
import { apiErrorResponse } from '@/lib/apiError';

// Editing and removing a material is Marketing's alone, for the same reason
// adding one is: it changes what the whole company sees. Everyone else reads.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isMarketingManager(viewer))) {
    return NextResponse.json({ error: 'Only the Marketing team can edit materials.' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findMaterialById(id);
    if (!existing) return NextResponse.json({ error: 'Material not found' }, { status: 404 });

    const patch: MaterialPatch = { actorId: viewer.userId };

    // Present-but-null means "move it to the top level", so this checks for
    // the key rather than for a truthy value.
    if ('folderId' in body) {
      const folderId = typeof body.folderId === 'string' && body.folderId ? body.folderId : null;
      if (folderId && !(await findFolderById(folderId))) {
        return NextResponse.json({ error: 'That folder no longer exists.' }, { status: 400 });
      }
      patch.folderId = folderId;
    }

    if (body.product !== undefined) {
      const product = typeof body.product === 'string' ? body.product.trim() : '';
      if (!product) return NextResponse.json({ error: 'A product or document name is required' }, { status: 400 });
      patch.product = product;
    }

    if (body.category !== undefined) {
      if (!isMaterialCategory(body.category)) return NextResponse.json({ error: 'Pick a category' }, { status: 400 });
      patch.category = body.category;
    }

    if (typeof body.title === 'string') patch.title = body.title.trim() || (patch.product ?? existing.product);
    if (typeof body.description === 'string') patch.description = body.description.trim();

    if (body.driveLink !== undefined) {
      const parsed = parseDriveLink(typeof body.driveLink === 'string' ? body.driveLink : '');
      if (!parsed) {
        return NextResponse.json(
          { error: 'That doesn’t look like a Google Drive link. Paste the link from Drive’s Share dialog or the address bar.' },
          { status: 400 }
        );
      }
      patch.driveFileId = parsed.id;
      patch.webViewLink = parsed.url;
      patch.isFolder = parsed.kind === 'folder';
    }

    return NextResponse.json({ material: await updateMaterial(id, patch) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isMarketingManager(viewer))) {
    return NextResponse.json({ error: 'Only the Marketing team can remove materials.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const existing = await findMaterialById(id);
    if (!existing) return NextResponse.json({ error: 'Material not found' }, { status: 404 });

    // Soft delete (the model is paranoid) — removing the entry never touches
    // the file in Drive, and a mistake here is recoverable.
    await deleteMaterial(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
