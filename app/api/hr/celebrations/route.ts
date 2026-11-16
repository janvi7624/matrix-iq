import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isCelebrationContributor, isHrManager } from '@/lib/hrAccess';
import {
  createCelebrationItem,
  isKnownCelebrationCategory,
  listAllCategories,
  listCelebrationItems,
  listSubfolders
} from '@/lib/companyCelebrationStore';

// Readable by every signed-in employee — this is the company's own
// celebration wall.
//   POST here: any department manager (isCelebrationContributor), not just
//     HR — they may upload a photo/video and create a new album for it.
//   PATCH/DELETE on [id]: HR may act on any item; a non-HR contributor only
//     on items they personally added (see that route's canActOn).
//   Folders and whole-album rename/delete stay HR-only (categories/ and
//   albums/ routes) — a manager can add content, not restructure the wall.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const categoryParam = url.searchParams.get('category');
  const subfolder = url.searchParams.get('subfolder') || undefined;

  try {
    // canManage: may manage the wall's STRUCTURE (folders, renaming/deleting
    // whole albums) — HR Manager only, unchanged.
    // canContribute: may upload a photo/video and create a new album — any
    // department manager, which is what makes per-item edit/delete below
    // meaningful for someone other than HR in the first place.
    const [canManage, canContribute] = await Promise.all([isHrManager(viewer), isCelebrationContributor(viewer)]);

    if (!categoryParam) {
      // Top level: the fixed seven plus whatever HR has added on top, each
      // with a count, so the wall's landing view can show every tile
      // without a folder picked yet.
      const categories = await listAllCategories();
      const counts: Record<string, number> = {};
      for (const category of categories) {
        counts[category.key] = (await listCelebrationItems({ category: category.key })).length;
      }
      return NextResponse.json({ categories, countByCategory: counts, canManage, canContribute });
    }

    if (!(await isKnownCelebrationCategory(categoryParam))) {
      return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
    }

    if (!subfolder) {
      const subfolders = await listSubfolders(categoryParam);
      return NextResponse.json({ category: categoryParam, subfolders, canManage, canContribute });
    }

    const items = await listCelebrationItems({ category: categoryParam, subfolder });
    // Per-item edit/delete right, computed here rather than left to the
    // client: HR may act on anything; a contributor only on their own
    // upload (createdById === viewer.userId) — same pattern Employee
    // Appreciation's GET uses for its own can_edit flag.
    const withEditFlag = items.map((item) => ({ ...item, canEdit: canManage || (canContribute && item.createdById === viewer.userId) }));
    return NextResponse.json({ category: categoryParam, subfolder, items: withEditFlag, canManage, canContribute });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Add a photo/video to a (possibly brand-new) subfolder. Any department
// manager, not just HR — see this file's header comment.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isCelebrationContributor(viewer))) {
    return NextResponse.json({ error: 'Only a manager or the HR Manager can add to the Company Celebration wall.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const category = typeof body.category === 'string' ? body.category : '';
  const subfolder = typeof body.subfolder === 'string' ? body.subfolder.trim() : '';
  const fileUrl = typeof body.fileUrl === 'string' ? body.fileUrl.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!(await isKnownCelebrationCategory(category))) return NextResponse.json({ error: 'Pick a category' }, { status: 400 });
  if (!subfolder) return NextResponse.json({ error: 'Give this album a name — e.g. the employee or event it is for' }, { status: 400 });
  if (!fileUrl) return NextResponse.json({ error: 'Upload a photo or video first' }, { status: 400 });

  try {
    const item = await createCelebrationItem({
      category,
      subfolder,
      title,
      description,
      fileUrl,
      mimeType,
      actorId: viewer.userId
    });
    return NextResponse.json({ item: { ...item, canEdit: true } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
