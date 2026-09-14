import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { getAllPaymentItems, sortPaymentQueue } from '@/lib/accountsPaymentStore';
import { toCsv } from '@/lib/csv';
import { apiErrorResponse } from '@/lib/apiError';

// No internal database ids exported (Part 26) — paymentId is the
// human-meaningful composite reference (source:sourceId), not a raw UUID.
const HEADERS = ['Payment ID', 'Source', 'Payee', 'Description', 'Amount', 'Department', 'Requested By', 'Approved By', 'Due Date', 'Payment Date', 'Payment Method', 'Reference', 'Status'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const items = sortPaymentQueue(await getAllPaymentItems());
    const rows = items.map((i) => [
      i.paymentId, i.sourceLabel, i.payee, i.description, i.amount, i.department,
      i.requestedBy, i.approvedBy, i.dueDate || '', i.paidAt || '', i.paymentMethod || '',
      i.paymentReference || '', i.status
    ]);
    const csv = toCsv(HEADERS, rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="accounts-payments.csv"'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
