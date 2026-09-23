import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findQuotationById, listQuotationVersions } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { canViewQuotation } from '@/lib/quotationAccess';

// Admins/managers see every revision; anyone else only sees version history
// for a quotation they can view (lib/quotationAccess.ts) — checked against
// the ROOT quotation, since every revision belongs to whoever owns the root.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const anyVersion = await findQuotationById(id);
    if (!anyVersion) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    const rootId = anyVersion.original_quotation_id || anyVersion.id;
    const root = await findQuotationById(rootId);
    if (root && !(await canViewQuotation(viewer.username, root))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const versions = await listQuotationVersions(id);
    return NextResponse.json(versions);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
