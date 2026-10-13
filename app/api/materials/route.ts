import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isMarketingManager } from '@/lib/permissions';
import { createMaterial, listMaterials, listProductNames } from '@/lib/materialStore';
import { isMaterialCategory, MATERIAL_CATEGORIES } from '@/lib/materialCategories';
import { groupByCategory } from '@/lib/materialGrouping';
import { parseDriveLink } from '@/lib/driveLink';
import { findFolderById, folderBreadcrumb, listSubfolders } from '@/lib/materialFolderStore';
import { apiErrorResponse } from '@/lib/apiError';

// Readable by EVERY signed-in user, by design — the point of the module is
// that anyone can find a datasheet without being given access to the Drive
// folder it lives in. Writing is Marketing's alone (POST below, and
// PATCH/DELETE on [id]).
//
// The response is grouped the way the library is browsed: category →
// product → link. Grouping happens here, not in the browser, so counts and
// ordering are identical for everyone and aren't re-derived per keystroke.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const categoryParam = url.searchParams.get('category');
  const search = (url.searchParams.get('search') || '').trim();
  const folderId = url.searchParams.get('folderId') || null;

  if (categoryParam && !isMaterialCategory(categoryParam)) {
    return NextResponse.json({ error: 'Unknown material category' }, { status: 400 });
  }

  // Searching or filtering by category looks through the WHOLE library, not
  // just the folder you're standing in — someone hunting "X200" wants it
  // found wherever it was filed. Plain browsing stays inside the folder.
  const flatMode = Boolean(search || categoryParam);

  try {
    if (folderId && !(await findFolderById(folderId))) {
      return NextResponse.json({ error: 'That folder no longer exists.' }, { status: 404 });
    }

    const [materials, canManage, subfolders, breadcrumb] = await Promise.all([
      listMaterials({
        category: categoryParam && isMaterialCategory(categoryParam) ? categoryParam : undefined,
        search,
        folderId,
        anyFolder: flatMode
      }),
      isMarketingManager(viewer),
      // No subfolders while searching: a flat result list with a folder grid
      // above it would imply the folders were results too.
      flatMode ? Promise.resolve([]) : listSubfolders(folderId),
      folderBreadcrumb(folderId)
    ]);

    const categories = groupByCategory(materials, MATERIAL_CATEGORIES);

    // Tab counts are over the WHOLE library — every folder — so they mean
    // the same thing wherever you're standing and don't change as you
    // navigate. Counted in PRODUCTS, because that's what a tab will show.
    const unfiltered = await listMaterials({ anyFolder: true });
    const unfilteredGroups = groupByCategory(unfiltered, MATERIAL_CATEGORIES);
    const countByCategory: Record<string, number> = {};
    for (const category of MATERIAL_CATEGORIES) countByCategory[category] = 0;
    for (const group of unfilteredGroups) countByCategory[group.category] = group.products.length;

    return NextResponse.json({
      categories,
      subfolders,
      breadcrumb,
      folderId,
      flatMode,
      matchCount: categories.reduce((total, group) => total + group.products.length, 0),
      totalProducts: unfilteredGroups.reduce((total, group) => total + group.products.length, 0),
      totalDocuments: unfiltered.length,
      countByCategory,
      canManage,
      // Only Marketing sees the add form, so only Marketing needs the
      // existing product names it suggests from.
      knownProducts: canManage ? await listProductNames() : []
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Publish a material: a product, a category, and its Drive link.
// Marketing-only — this writes what the whole company sees.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isMarketingManager(viewer))) {
    return NextResponse.json({ error: 'Only the Marketing team can add materials.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const folderId = typeof body.folderId === 'string' && body.folderId ? body.folderId : null;
  const product = typeof body.product === 'string' ? body.product.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const link = typeof body.driveLink === 'string' ? body.driveLink.trim() : '';

  if (!product) return NextResponse.json({ error: 'A product or document name is required' }, { status: 400 });
  if (!isMaterialCategory(body.category)) return NextResponse.json({ error: 'Pick a category' }, { status: 400 });

  // Parsed, not merely stored: a mistyped or non-Drive URL is caught here
  // rather than becoming an "Open" button that leads nowhere.
  const parsed = parseDriveLink(link);
  if (!parsed) {
    return NextResponse.json(
      { error: 'That doesn’t look like a Google Drive link. Paste the link from Drive’s Share dialog or the address bar.' },
      { status: 400 }
    );
  }

  try {
    // Checked rather than trusted: a folder deleted in another tab would
    // otherwise fail as a raw foreign-key violation.
    if (folderId && !(await findFolderById(folderId))) {
      return NextResponse.json({ error: 'That folder no longer exists.' }, { status: 400 });
    }

    const material = await createMaterial({
      folderId,
      product,
      category: body.category,
      title: title || product,
      description,
      driveFileId: parsed.id,
      webViewLink: parsed.url,
      isFolder: parsed.kind === 'folder',
      actorId: viewer.userId
    });
    return NextResponse.json({ material }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
