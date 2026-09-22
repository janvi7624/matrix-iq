import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listHandoverRecipients } from '@/lib/leadHandover';
import { apiErrorResponse } from '@/lib/apiError';

// Who a capturer can hand a scanned card over to — the "Whose lead is this?"
// dropdown on Lead Capture's Confirm Details step. Open to anyone who can
// capture a lead (unlike /api/leads/assignees, the sales manager's routing
// list): the front desk scanning a card for a colleague is exactly the case.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json({ recipients: await listHandoverRecipients(viewer) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
