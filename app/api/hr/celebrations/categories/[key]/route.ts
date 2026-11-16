import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isHrManager } from '@/lib/hrAccess';
import { deleteCustomCategory, isFixedCelebrationCategory, updateCustomCategory } from '@/lib/companyCelebrationStore';

// Rename / re-icon or delete a custom top-level folder (the built-in seven
// are fixed). Deleting removes every album and photo inside it.
// HR Manager, admin, superadmin.

async function gate(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Only the HR Manager can change folders on the Company Celebration wall.' }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const denied = await gate(request);
  if (denied) return denied;
  const { key } = await params;
  if (isFixedCelebrationCategory(key)) return NextResponse.json({ error: 'Built-in folders cannot be edited.' }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  if (typeof body.label === 'string' && !body.label.trim()) return NextResponse.json({ error: 'Give this folder a name.' }, { status: 400 });
  try {
    const category = await updateCustomCategory(key, {
      label: typeof body.label === 'string' ? body.label : undefined,
      icon: typeof body.icon === 'string' ? body.icon : undefined
    });
    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ category });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const denied = await gate(request);
  if (denied) return denied;
  const { key } = await params;
  if (isFixedCelebrationCategory(key)) return NextResponse.json({ error: 'Built-in folders cannot be deleted.' }, { status: 400 });
  try {
    const deleted = await deleteCustomCategory(key);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
