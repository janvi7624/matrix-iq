import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isHrManager } from '@/lib/hrAccess';
import { deleteCelebrationItem } from '@/lib/companyCelebrationStore';

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
