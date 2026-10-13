import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { getAllPaymentItems } from '@/lib/accountsPaymentStore';
import { applyPaymentFilters, collectFacets, parsePaymentFilters, summariseFiltered } from '@/lib/paymentFilters';
import { PaymentQueueItem } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));

    // History is about money leaving, so a month/quarter/year filter here
    // means "PAID in that period" — the same filter answering the question
    // this tab is actually asking.
    const filters = parsePaymentFilters(url.searchParams, 'paidAt');

    const paid = (await getAllPaymentItems()).filter((i) => i.status === 'paid');
    const filtered = applyPaymentFilters(paid, filters);

    const sorted = [...filtered].sort((a, b) => new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime());
    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const pageItems: PaymentQueueItem[] = sorted.slice(start, start + pageSize);

    return NextResponse.json({
      items: pageItems,
      total,
      page,
      pageSize,
      totals: summariseFiltered(filtered),
      facets: collectFacets(paid)
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
