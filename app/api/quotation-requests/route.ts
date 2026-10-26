import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listQuotationRequestsForSales } from '@/lib/partnerQuotationRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { apiErrorResponse } from '@/lib/apiError';

// The sales-side queue of partner quotation requests.
//
// getViewerContext WITHOUT allowPartner, so the deny-by-default in
// lib/viewerContext.ts refuses partner accounts here — they read their own
// requests through /api/partner/quotation-requests, which is scoped by
// partner_id. This endpoint returns every partner's.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const url = new URL(request.url);
    const openOnly = url.searchParams.get('open') === '1';

    // Whoever can approve on the module sees the whole queue; everyone else
    // sees only requests against projects they own. Same shape as the
    // marketing-requests list, so "can I see all of these" has one answer
    // across the app rather than a new rule per module.
    const seesAll = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'quotation-requests', 'approve'));

    const rows = await listQuotationRequestsForSales({
      salesPerson: seesAll ? undefined : viewer.username,
      openOnly
    });
    return NextResponse.json(rows);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
