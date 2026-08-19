import { NextRequest, NextResponse } from 'next/server';
import { searchQuotationsFiltered } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { QuotationEffectiveStatus } from '@/lib/types';
import { getViewerContext } from '@/lib/viewerContext';

const VALID_STATUSES: QuotationEffectiveStatus[] = ['draft', 'sent', 'approved', 'rejected', 'expired'];

// Base admin-panel access is enforced by proxy.ts (matcher:
// /api/admin/quotations/:path*) — reaching this route only requires
// isPrivileged (a capability), not org-wide data visibility, so results are
// still clamped to the viewer's own department scope below; the salesPerson
// filter narrows further within that scope, it never widens past it.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const records = await searchQuotationsFiltered({
      query: params.get('q') || undefined,
      viewerUsername: viewer.username,
      ownerUsername: params.get('salesPerson') || undefined,
      projectId: params.get('projectId') || undefined,
      status: status && VALID_STATUSES.includes(status as QuotationEffectiveStatus) ? (status as QuotationEffectiveStatus) : undefined,
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined
    });
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
