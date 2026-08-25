import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { apiErrorResponse } from '@/lib/apiError';
import { findUserByUsername } from '@/lib/userStore';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const url = new URL(request.url);
    const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
    const month = Number(url.searchParams.get('month')) || (new Date().getMonth() + 1);

    const user = await findUserByUsername(viewer.username);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const sheet = await reimbursementSheetStore.findOrCreate(user.id, year, month);
    return NextResponse.json(sheet);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
