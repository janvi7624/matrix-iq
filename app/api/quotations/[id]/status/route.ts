import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findQuotationById, updateQuotationStatus } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { QuotationStatus } from '@/lib/types';
import { canAccessOwnedRecord } from '@/lib/departmentScope';

const VALID_STATUSES: QuotationStatus[] = ['draft', 'sent', 'approved', 'rejected'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'A valid status is required' }, { status: 400 });
  }

  try {
    const existing = await findQuotationById(id);
    if (!existing) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    if (!(await canAccessOwnedRecord(viewer.username, existing.created_by))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await updateQuotationStatus(id, body.status, viewer.username);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
