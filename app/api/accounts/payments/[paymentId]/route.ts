import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { findPaymentItem, getOfficeExpenseSheetEntries } from '@/lib/accountsPaymentStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { paymentId } = await params;
  try {
    const item = await findPaymentItem(paymentId);
    if (!item) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    // An Office Operation Expense sheet's line items come from here rather
    // than the module's own /api/office-operation-expenses, which is
    // HR/Admin-only — the Accounts team (role 'accounts') would get a 403
    // there, but this route is already gated on isAccountsPaymentActor.
    if (item.source === 'office_expense') {
      const entries = await getOfficeExpenseSheetEntries(item.sourceId);
      return NextResponse.json({ ...item, entries: entries ?? [] });
    }
    return NextResponse.json(item);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
