import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findQuotationById, logQuotationFollowUp } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { canAccessOwnedRecord } from '@/lib/departmentScope';

// Owner-or-privileged version of /api/admin/quotations/[id]/follow-up — lets
// a sales user log a follow-up on their own quotation from My Quotations,
// which isn't under /api/admin so it isn't blocked by the admin-only gate.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const note = typeof body?.note === 'string' ? body.note.trim() : '';

  try {
    const existing = await findQuotationById(id);
    if (!existing) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    if (!(await canAccessOwnedRecord(viewer.username, existing.created_by))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await logQuotationFollowUp(id, viewer.username, note);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
