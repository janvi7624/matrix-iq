import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { apiErrorResponse } from '@/lib/apiError';
import { findUserByUsername } from '@/lib/userStore';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const user = await findUserByUsername(viewer.username);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const sheets = await reimbursementSheetStore.listActedOn(user.id);
    return NextResponse.json({ sheets });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
