import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isHrManager } from '@/lib/hrAccess';
import {
  CELEBRATION_CATEGORIES,
  createCelebrationItem,
  isCelebrationCategory,
  listCelebrationItems,
  listSubfolders
} from '@/lib/companyCelebrationStore';

// Readable by every signed-in employee — this is the company's own
// celebration wall. Writing (POST here, DELETE on [id]) is HR Manager only.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const categoryParam = url.searchParams.get('category');
  const subfolder = url.searchParams.get('subfolder') || undefined;

  if (categoryParam && !isCelebrationCategory(categoryParam)) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
  }

  try {
    const canManage = await isHrManager(viewer);

    if (!categoryParam) {
      // Top level: just the fixed category list and a count per category, so
      // the wall's landing view can show all seven tiles without a folder
      // picked yet.
      const counts: Record<string, number> = {};
      for (const category of CELEBRATION_CATEGORIES) {
        counts[category] = (await listCelebrationItems({ category })).length;
      }
      return NextResponse.json({ categories: CELEBRATION_CATEGORIES, countByCategory: counts, canManage });
    }

    if (!isCelebrationCategory(categoryParam)) {
      return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
    }

    if (!subfolder) {
      const subfolders = await listSubfolders(categoryParam);
      return NextResponse.json({ category: categoryParam, subfolders, canManage });
    }

    const items = await listCelebrationItems({ category: categoryParam, subfolder });
    return NextResponse.json({ category: categoryParam, subfolder, items, canManage });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Add a photo/video to a (possibly brand-new) subfolder. HR Manager only —
// the celebration wall is HR-curated; nobody else may post to it.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Only the HR Manager can add to the Company Celebration wall.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const category = body.category;
  const subfolder = typeof body.subfolder === 'string' ? body.subfolder.trim() : '';
  const fileUrl = typeof body.fileUrl === 'string' ? body.fileUrl.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!isCelebrationCategory(category)) return NextResponse.json({ error: 'Pick a category' }, { status: 400 });
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
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
