import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { getAllPaymentItems } from '@/lib/accountsPaymentStore';
import { PaymentQueueItem } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const url = new URL(request.url);
    const source = url.searchParams.get('source') || 'all';
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));

    let items = (await getAllPaymentItems()).filter((i) => i.status === 'paid');

    if (source !== 'all') items = items.filter((i) => i.source === source);
    if (search) {
      items = items.filter((i) =>
        i.paymentId.toLowerCase().includes(search) ||
        i.payee.toLowerCase().includes(search) ||
        i.description.toLowerCase().includes(search) ||
        i.paymentReference?.toLowerCase().includes(search)
      );
    }
    if (dateFrom) items = items.filter((i) => i.paidAt && new Date(i.paidAt) >= new Date(dateFrom));
    if (dateTo) items = items.filter((i) => i.paidAt && new Date(i.paidAt) <= new Date(dateTo));

    const sorted = [...items].sort((a, b) => new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime());
    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const pageItems: PaymentQueueItem[] = sorted.slice(start, start + pageSize);

    return NextResponse.json({ items: pageItems, total, page, pageSize });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
