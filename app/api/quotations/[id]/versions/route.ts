import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findQuotationById, listQuotationVersions } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { canAccessOwnedRecord } from '@/lib/departmentScope';

// Admins/managers see every revision; a Sales user only sees version
// history for quotations they created themselves (checked against the ROOT
// quotation's owner, since every revision belongs to whoever owns the root).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const anyVersion = await findQuotationById(id);
    if (!anyVersion) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    const rootId = anyVersion.original_quotation_id || anyVersion.id;
    const root = await findQuotationById(rootId);
    if (root && !(await canAccessOwnedRecord(viewer.username, root.created_by))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const versions = await listQuotationVersions(id);
    return NextResponse.json(versions);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
