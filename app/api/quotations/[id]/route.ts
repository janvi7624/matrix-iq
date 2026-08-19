import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findQuotationById } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { canAccessOwnedRecord } from '@/lib/departmentScope';

// Single-quotation lookup — used both to prefill the "Revise" flow and by
// the version-history panel to resolve one specific version's detail.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const quotation = await findQuotationById(id);
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    if (!(await canAccessOwnedRecord(viewer.username, quotation.created_by))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(quotation);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
