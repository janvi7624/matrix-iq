import { NextRequest, NextResponse } from 'next/server';
import { searchQuotationsFiltered } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { QuotationEffectiveStatus } from '@/lib/types';

const VALID_STATUSES: QuotationEffectiveStatus[] = ['draft', 'sent', 'approved', 'rejected', 'expired'];

// Auth is enforced by proxy.ts (matcher: /api/admin/quotations/:path*) —
// only admin/manager/superadmin reach this, so it's always org-wide;
// filters (salesPerson/status/project/date range) narrow that view.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const records = await searchQuotationsFiltered({
      query: params.get('q') || undefined,
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
