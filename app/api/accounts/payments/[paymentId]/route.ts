import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { findPaymentItem } from '@/lib/accountsPaymentStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { paymentId } = await params;
  try {
    const item = await findPaymentItem(paymentId);
    if (!item) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    return NextResponse.json(item);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
