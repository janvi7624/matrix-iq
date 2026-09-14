import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { getAllPaymentItems, sortPaymentQueue } from '@/lib/accountsPaymentStore';
import { PaymentQueueItem } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

// Server-side filter/sort/paginate over the aggregated queue — the working
// set (payment_required + on_hold + recently paid across 4 sources) is
// inherently small, not the full historical ledger, so merging in memory
// here is the right tradeoff against querying 4 heterogeneous tables with a
// single SQL UNION (which their differing schemas don't support cleanly
// anyway). History (a much larger, ever-growing set) gets its own route.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const url = new URL(request.url);
    const source = url.searchParams.get('source') || 'all';
    const status = url.searchParams.get('status') || 'all';
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));

    let items = (await getAllPaymentItems()).filter((i) => i.status !== 'paid');

    if (source !== 'all') items = items.filter((i) => i.source === source);
    if (status !== 'all') items = items.filter((i) => i.status === status);
    if (search) {
      items = items.filter((i) =>
        i.paymentId.toLowerCase().includes(search) ||
        i.payee.toLowerCase().includes(search) ||
        i.description.toLowerCase().includes(search) ||
        i.requestedBy.toLowerCase().includes(search) ||
        i.sourceLabel.toLowerCase().includes(search)
      );
    }
    if (dateFrom) items = items.filter((i) => new Date(i.createdAt) >= new Date(dateFrom));
    if (dateTo) items = items.filter((i) => new Date(i.createdAt) <= new Date(dateTo));

    const sorted = sortPaymentQueue(items);
    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const pageItems: PaymentQueueItem[] = sorted.slice(start, start + pageSize);

    return NextResponse.json({ items: pageItems, total, page, pageSize });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
