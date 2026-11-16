import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isHrManager } from '@/lib/hrAccess';
import { deleteSubfolder, isKnownCelebrationCategory, renameSubfolder } from '@/lib/companyCelebrationStore';

// An album has no row of its own (it is the shared `subfolder` name of its
// items), so it is addressed by { category, subfolder } in the body.
//   PATCH  { category, subfolder, name }  rename
//   DELETE { category, subfolder }        delete the album and all its media
// HR Manager, admin, superadmin.

type Parsed = { error: NextResponse } | { error?: undefined; body: Record<string, unknown>; category: string; subfolder: string };

async function parse(request: NextRequest): Promise<Parsed> {
  const viewer = await getViewerContext(request);
  if (!viewer) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!(await isHrManager(viewer))) {
    return { error: NextResponse.json({ error: 'Only the HR Manager can change albums on the Company Celebration wall.' }, { status: 403 }) };
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const category = typeof body?.category === 'string' ? body.category : '';
  const subfolder = typeof body?.subfolder === 'string' ? body.subfolder : '';
  if (!body || !subfolder || !(await isKnownCelebrationCategory(category))) {
    return { error: NextResponse.json({ error: 'Album not specified' }, { status: 400 }) };
  }
  return { body, category, subfolder };
}

export async function PATCH(request: NextRequest) {
  const r = await parse(request);
  if (r.error) return r.error;
  const name = typeof r.body.name === 'string' ? r.body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Give this album a name.' }, { status: 400 });
  try {
    const moved = await renameSubfolder(r.category, r.subfolder, name);
    if (!moved) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, name });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const r = await parse(request);
  if (r.error) return r.error;
  try {
    const removed = await deleteSubfolder(r.category, r.subfolder);
    if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
