import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { reimbursementStore } from '@/lib/reimbursementStore';
import { numberToIndianWords } from '@/lib/numberToWords';
import { apiErrorResponse } from '@/lib/apiError';
import { findUserByUsername } from '@/lib/userStore';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const sheet = await reimbursementSheetStore.findById(id);
    if (!sheet) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });

    const creator = await findUserByUsername(sheet.created_by);
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 });

    const records = await reimbursementStore.listByUserId(creator.id, sheet.year, sheet.month);
    const total = records.reduce((sum, r) => sum + r.amount, 0);

    return NextResponse.json({ sheet, records, total, totalInWords: numberToIndianWords(total) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
