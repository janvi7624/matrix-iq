import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { getAllPaymentItems, sortPaymentQueue } from '@/lib/accountsPaymentStore';
import { applyPaymentFilters, collectFacets, parsePaymentFilters, summariseFiltered } from '@/lib/paymentFilters';
import { PaymentQueueItem } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

// Server-side filter/sort/paginate over the aggregated queue — the working
// set (payment_required + on_hold + recently paid across 4 sources) is
// inherently small, not the full historical ledger, so merging in memory
// here is the right tradeoff against querying 4 heterogeneous tables with a
// single SQL UNION (which their differing schemas don't support cleanly
// anyway). History (a much larger, ever-growing set) gets its own route.
//
// Every filter lives in lib/paymentFilters.ts, shared with the history route
// and the CSV export, so an export can never disagree with the list that
// produced it.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));

    // The queue is about work arriving, so a month/quarter/year filter here
    // means "raised in that period".
    const filters = parsePaymentFilters(url.searchParams, 'createdAt');

    const unpaid = (await getAllPaymentItems()).filter((i) => i.status !== 'paid');
    const filtered = applyPaymentFilters(unpaid, filters);

    const sorted = sortPaymentQueue(filtered);
    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const pageItems: PaymentQueueItem[] = sorted.slice(start, start + pageSize);

    return NextResponse.json({
      items: pageItems,
      total,
      page,
      pageSize,
      // Totals over every match, not just this page — "how much does Sales
      // need paying this quarter" is unanswerable from 20 rows.
      totals: summariseFiltered(filtered),
      // Dropdown options from the UNFILTERED set, so picking a department
      // never empties the employee list and strands someone with no way back.
      facets: collectFacets(unpaid)
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
