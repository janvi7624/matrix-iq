import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { searchQuotationsFiltered } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { QuotationEffectiveStatus } from '@/lib/types';

const VALID_STATUSES: QuotationEffectiveStatus[] = ['draft', 'sent', 'approved', 'rejected', 'expired'];

// Every logged-in role can hit this — it's always scoped to the caller's own
// quotations (created_by === session.username), so there's no separate
// admin-only gate needed here the way /api/admin/quotations has.
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const status = params.get('status');

  try {
    const rows = await searchQuotationsFiltered({
      ownerUsername: session.username,
      query: params.get('q') || undefined,
      projectId: params.get('projectId') || undefined,
      status: status && VALID_STATUSES.includes(status as QuotationEffectiveStatus) ? (status as QuotationEffectiveStatus) : undefined,
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined
    });
    return NextResponse.json(rows);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
