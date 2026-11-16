import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isHrManager } from '@/lib/hrAccess';
import { createCustomCategory } from '@/lib/companyCelebrationStore';

// Add an extra top-level folder to the celebration wall, beyond the fixed
// seven — e.g. "Sports Day" or "CSR Activities". HR Manager only, same gate
// as every other write on this wall.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Only the HR Manager can add a folder to the Company Celebration wall.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const icon = typeof body.icon === 'string' ? body.icon.trim() : '';
  if (!label) return NextResponse.json({ error: 'Give this folder a name.' }, { status: 400 });

  try {
    const category = await createCustomCategory({ label, icon, actorId: viewer.userId });
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
