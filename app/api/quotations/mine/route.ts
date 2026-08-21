import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { searchQuotationsFiltered } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { QuotationEffectiveStatus } from '@/lib/types';

const VALID_STATUSES: QuotationEffectiveStatus[] = ['draft', 'sent', 'approved', 'rejected', 'expired'];

// Every logged-in role can hit this.
// Privileged viewers (manager, admin, superadmin) see all quotations across the organization
// by default, or can filter by a specific sales person.
// Non-privileged users (sales reps / user) strictly see only their own quotations.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const status = params.get('status');
  const salesPersonParam = params.get('salesPerson')?.trim();

  const ownerUsername = viewer.isPrivileged
    ? (salesPersonParam || undefined)
    : viewer.username;

  try {
    const rows = await searchQuotationsFiltered({
      ownerUsername,
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
