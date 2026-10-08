import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { apiErrorResponse } from '@/lib/apiError';

// Accounts' month-by-employee reimbursement summary — same access gate as
// the payment queue it sits alongside (components/AccountsPaymentsView.tsx).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const pivot = await reimbursementSheetStore.getReimbursementPivot();
    return NextResponse.json(pivot);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
